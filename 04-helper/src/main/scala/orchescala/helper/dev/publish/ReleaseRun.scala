package orchescala.helper.dev.publish

/** The steps of a release, in their order - see [[releaseSteps]]. */
enum ReleaseStep:
  case Build, UploadDocs, Upload, Git

/** The two sbt runs of a release.
  *
  * `build` is where the build may fail: every module is compiled and packaged as `publish`
  * packages it (the jar, the sources, the pom - `publishLocal` would do the same, but it
  * writes the release version to `~/.ivy2/local`, where it shadows the repository), the
  * docker image is built (`Docker / publishLocal`), the docs are generated. `publish`
  * repeats the packaging (the compiler and docker reuse their caches) and uploads - what is
  * left to fail there is the upload itself (credentials, network, a taken version). The
  * docker image is pushed before the artifacts - its tag can be overwritten, the artifacts
  * can not.
  */
case class SbtRuns(build: Seq[String], publish: Seq[String])

object SbtRuns:
  def of(
      dockerProject: Option[String],
      build: Seq[String] = Seq.empty,
      sbtOptions: Seq[String] = Seq.empty
  ): SbtRuns =
    val sbt = "sbt" +: sbtOptions
    SbtRuns(
      build = sbt ++ Seq("package", "packageSrc", "makePom") ++
        dockerProject.map(p => s"$p / Docker / publishLocal") ++ build,
      publish = sbt ++ dockerProject.map(p => s"$p / Docker / publish") :+ "publish"
    )
  end of

  /** The sbt runs of a project - the docs (`api/run`) come with the build. */
  def project(hasWorkerApp: Boolean): SbtRuns =
    of(Option.when(hasWorkerApp)("worker"), build = Seq("api/run"), sbtOptions = Seq("-J-Xmx3G"))

  /** The sbt runs of the company project - the gateway is its docker image. */
  def company(hasGateway: Boolean): SbtRuns =
    of(Option.when(hasGateway)("gateway"), sbtOptions = Seq("-J-Xmx3G"))
end SbtRuns

/** Runs the steps of a release - a failing step throws and stops the release there. The
  * sbt processes (`exec`) are replaced in the tests.
  */
case class ReleaseRun(
    runs: SbtRuns,
    uploadDocs: () => Unit,
    git: () => Unit,
    exec: Seq[String] => Unit = SbtChild.run,
    // called with the failed step before the failure is rethrown - see restoreForRetry
    onFailure: ReleaseStep => Unit = _ => (),
    // after a failed upload, before the restore - names what went out
    afterFailedUpload: () => Unit = () => (),
    // Ctrl-C: the sbt child gets it too and may still write - waited for before the restore
    awaitChild: () => Unit = () => SbtChild.awaitExit(),
    // the JVM's shutdown hooks - replaced in the tests
    addShutdownHook: Thread => Unit = Runtime.getRuntime.addShutdownHook,
    removeShutdownHook: Thread => Unit = Runtime.getRuntime.removeShutdownHook(_)
):
  /** Ctrl-C ends the JVM, no exception reaches the release - this hook restores the running
    * step's changes (registered while the step runs), once the sbt child ended.
    */
  def abortedAt(step: ReleaseStep): Thread =
    Thread: () =>
      println(s"Aborted at $step")
      try
        awaitChild()
        if step == ReleaseStep.Upload then afterFailedUpload()
        onFailure(step)
      catch case scala.util.control.NonFatal(restore) => restore.printStackTrace()

  def run(steps: Seq[ReleaseStep]): Unit =
    steps.foreach: step =>
      val aborted = abortedAt(step)
      addShutdownHook(aborted)
      try run(step)
      catch
        // a fatal error goes through without a restore
        case scala.util.control.NonFatal(e) =>
          if step == ReleaseStep.Upload then
            println(
              "The upload failed: the docker image (if any) is pushed already, and the modules `publish` " +
                "uploaded before it failed are in the repository. The next try fails the check of the version " +
                "until you remove the version there - then it overwrites the image's tag."
            )
            try afterFailedUpload()
            catch case scala.util.control.NonFatal(report) => e.addSuppressed(report)
          // the failure of the release stays the error - a failing restore is added to it
          try onFailure(step)
          catch case scala.util.control.NonFatal(restore) => e.addSuppressed(restore)
          throw e
      finally
        // refused while the JVM shuts down - then the hook runs anyway
        try removeShutdownHook(aborted)
        catch case _: IllegalStateException => ()

  private def run(step: ReleaseStep): Unit =
    step match
      case ReleaseStep.Build      =>
        println(s"SBT build: ${runs.build.mkString(" ")}")
        exec(runs.build)
      case ReleaseStep.UploadDocs => uploadDocs()
      case ReleaseStep.Upload     =>
        println(s"SBT publish: ${runs.publish.mkString(" ")}")
        exec(runs.publish)
      case ReleaseStep.Git        => git()
end ReleaseRun

object ReleaseRun:
  /** A release version is immutable in the repository (Artifactory): when the docker build or
    * the docs failed after `sbt publish`, the version was taken and the next try needed a new
    * one. So everything that can fail at build time runs first ([[SbtRuns]]), the upload
    * comes last - a failed release is run again with the same version.
    *
    * The docs go to the webserver BEFORE the upload: the webserver takes a version again, the
    * repository does not. So a release that fails at the upload is repeated with the same
    * version - its docs are simply uploaded again, while a release that failed at the docs
    * after the upload could never be repeated.
    */
  def steps(isSnapshot: Boolean, hasDocs: Boolean): Seq[ReleaseStep] =
    import ReleaseStep.*
    if isSnapshot then Seq(Build, Upload)
    else Seq(Build) ++ Option.when(hasDocs)(UploadDocs) ++ Seq(Upload, Git)
  end steps
end ReleaseRun

/** The sbt child of a release - run on the console; a shutdown hook waits for it to end
  * before it restores the working tree (the child got the Ctrl-C too and may still write).
  */
object SbtChild:
  // spawned and registered under the lock - a hook never misses a child just spawned; a
  // child gone from here has exited (`waitFor` returned), its output went to the console directly
  private var running: Option[os.SubProcess] = None

  def run(cmd: Seq[String]): Unit =
    println(cmd.mkString(" "))
    val child = synchronized:
      val c = os.proc(cmd).spawn(stdout = os.Inherit, stderr = os.Inherit)
      running = Some(c)
      c
    try
      child.waitFor()
      if child.exitCode() != 0 then
        throw IllegalStateException(s"`${cmd.mkString(" ")}` failed with exit code ${child.exitCode()}")
    catch
      // the thread was interrupted (a caller in a thread of its own) - the child must not go
      // on writing while the tree is restored
      case e: InterruptedException =>
        end(child, s"`${cmd.mkString(" ")}` (interrupted)")
        throw e
    finally synchronized { running = None }
  end run

  /** Waits for the running child - at most `timeout`; then it is ended: on Ctrl-C it got
    * the signal too and ends on its own, but it must not go on writing while the tree is
    * restored.
    */
  def awaitExit(timeout: scala.concurrent.duration.FiniteDuration = scala.concurrent.duration.Duration(30, "seconds")): Unit =
    synchronized(running).foreach: child =>
      println("Waiting for sbt to end ...")
      if !child.waitFor(timeout.toMillis) then end(child, s"sbt (not ended within $timeout)")

  /** Ends the child (the sbt launcher) and what it started (the sbt JVM, docker) - forcibly
    * after 5 seconds.
    */
  private def end(child: os.SubProcess, what: String): Unit =
    val handle  = child.wrapped.toHandle
    val started = handle.descendants().toList
    println(s"Ending $what - pid ${handle.pid} and the ${started.size} processes it started")
    started.forEach(_.destroy())
    child.destroy()
    if !child.waitFor(5000) then
      println(s"$what did not end - killed.")
      handle.descendants().forEach(_.destroyForcibly())
      child.destroyForcibly()
      child.waitFor(5000)
  end end
end SbtChild
