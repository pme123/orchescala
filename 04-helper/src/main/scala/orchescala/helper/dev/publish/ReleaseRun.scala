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
  * docker image is built again for the push (`Docker / publish` depends on `publishLocal` in
  * sbt-native-packager - the image of the first run can not be pushed as it is); the layers
  * come from the cache, so it is the same image unless the sources changed in between. The
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
  def project(hasWorkerApp: Boolean, sbtOptions: Seq[String] = SbtRuns.defaultSbtOptions): SbtRuns =
    of(Option.when(hasWorkerApp)("worker"), build = Seq("api/run"), sbtOptions = sbtOptions)

  /** The sbt runs of the company project - the gateway is its docker image. */
  def company(hasGateway: Boolean, sbtOptions: Seq[String] = SbtRuns.defaultSbtOptions): SbtRuns =
    of(Option.when(hasGateway)("gateway"), sbtOptions = sbtOptions)

  /** The options of the sbt runs of a release (`SbtConfig.publishSbtOptions`) - the heap the
    * company project always had; a runner with less memory sets its own.
    */
  val defaultSbtOptions: Seq[String] = Seq("-J-Xmx3G")
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
  // on Ctrl-C the failing sbt run AND the shutdown hook handle the same step - the restore is
  // once only by itself, the report (curl for every pom) is made so here
  private val reported = java.util.concurrent.atomic.AtomicBoolean(false)

  private def reportOnce(): Unit =
    if reported.compareAndSet(false, true) then afterFailedUpload()

  /** Ctrl-C ends the JVM, no exception reaches the release - this hook restores the running
    * step's changes (registered while the step runs), once the sbt child ended.
    */
  def abortedAt(step: ReleaseStep): Thread =
    Thread: () =>
      println(s"Aborted at $step")
      try
        awaitChild()
        onFailure(step) // first - the report is best effort and may take a while
        if step == ReleaseStep.Upload then reportOnce()
      catch case scala.util.control.NonFatal(restore) => restore.printStackTrace()

  def run(steps: Seq[ReleaseStep]): Unit =
    steps.foreach: step =>
      val aborted = abortedAt(step)
      addShutdownHook(aborted)
      try run(step)
      catch
        // whatever ended the step - a fatal error too (best effort then): it stays the error,
        // a failing restore or report is added to it
        case e: Throwable =>
          onFailureOf(step, e)
          throw e
      finally
        // refused while the JVM shuts down - then the hook runs anyway
        try removeShutdownHook(aborted)
        catch case _: IllegalStateException => ()

  /** The step failed with `e`: the restore first, then (an upload) what went out - the report
    * is best effort and may take a while.
    */
  private def onFailureOf(step: ReleaseStep, e: Throwable): Unit =
    suppressedBy(e)(onFailure(step))
    if step == ReleaseStep.Upload then
      println(
        "The upload failed: the docker image (if any) is pushed already, and the modules `publish` " +
          "uploaded before it failed are in the repository. The next try fails the check of the version " +
          "until you remove the version there - then it overwrites the image's tag."
      )
      suppressedBy(e)(reportOnce())

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
  // every access under the lock: spawned and registered together (one at a time, a hook never
  // misses a child just spawned); a child gone from here has exited (`waitFor` returned), its
  // output went to the console directly. The child is the sbt JVM itself - the `sbt` script
  // execs it - and what it started (docker) are its descendants; a descendant that outlives
  // its parent is not found any more (said by `terminate`).
  private var running: Option[os.SubProcess] = None

  /** One at a time - a release runs its sbt steps one after the other. */
  def run(cmd: Seq[String]): Unit =
    println(cmd.mkString(" "))
    val child = synchronized:
      if running.nonEmpty then
        throw IllegalStateException(s"An sbt run is going on already - `${cmd.mkString(" ")}` can not start.")
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
        terminate(child, s"`${cmd.mkString(" ")}` (interrupted)")
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
      if !child.waitFor(timeout.toMillis) then terminate(child, s"sbt (not ended within $timeout)")

  /** Ends the child (the sbt launcher) and what it started (the sbt JVM, docker) - forcibly
    * after 5 seconds.
    */
  private def terminate(child: os.SubProcess, what: String): Unit =
    import scala.jdk.CollectionConverters.*
    val handle  = child.wrapped.toHandle
    // the snapshot stays valid once the child is gone and they are reparented - one started
    // in between is missed, and one that ignores the signals may go on (said below)
    val started = handle.descendants().toList.asScala.toSeq
    println(s"Ending $what - pid ${handle.pid} and the ${started.size} processes it started")
    child.destroy()
    started.foreach(_.destroy())
    if !child.waitFor(5000) then
      child.destroyForcibly()
      child.waitFor(5000)
    started.filter(_.isAlive).foreach(_.destroyForcibly())
    // a killed process takes a moment to go - up to 5 seconds
    val deadline = System.currentTimeMillis() + 5000
    while (child.isAlive() || started.exists(_.isAlive)) && System.currentTimeMillis() < deadline do
      Thread.sleep(100)
    val stillAlive = Option.when(child.isAlive())(handle.pid).toSeq ++ started.filter(_.isAlive).map(_.pid)
    if stillAlive.nonEmpty then
      println(
        s"WARNING: $what did not end (pids ${stillAlive.mkString(", ")}) - it may still write " +
          "while the working tree is restored."
      )
    else println(s"$what ended.")
  end terminate
end SbtChild

/** `body` after a failure `e` - fails it too, that is added to `e` (which stays the error). */
private[publish] def suppressedBy(e: Throwable)(body: => Unit): Unit =
  try body
  catch case scala.util.control.NonFatal(r) => e.addSuppressed(r) // a fatal one goes through
