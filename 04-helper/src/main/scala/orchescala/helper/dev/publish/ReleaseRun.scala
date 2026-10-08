package orchescala.helper.dev.publish

/** The steps of a release, in their order - see [[ReleaseRun.steps]]. */
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
final class ReleaseRun(
    val runs: SbtRuns,
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
    removeShutdownHook: Thread => Unit = Runtime.getRuntime.removeShutdownHook(_),
    // a snapshot is overwritable: no check of the version ran, nothing to report after a failed upload
    isSnapshot: Boolean = false
):
  // on Ctrl-C the failing sbt run AND the shutdown hook handle the same step - the restore is
  // once only by itself, the report (curl for every pom) is made so here: the second caller
  // waits for the first (the JVM ends with the hook) and finds it done
  private val reportLock = Object()
  private var reported   = false

  private def reportOnce(): Unit =
    reportLock.synchronized:
      if !reported then
        reported = true
        afterFailedUpload()

  /** Ctrl-C ends the JVM, no exception reaches the release - this hook restores the running
    * step's changes (registered while the step runs), once the sbt child ended.
    */
  def abortedAt(step: ReleaseStep): Thread =
    Thread: () =>
      println(s"Aborted at $step")
      try
        awaitChild()
        onFailure(step) // first - the report is best effort and may take a while
        if step == ReleaseStep.Upload && !isSnapshot then reportOnce()
      catch case scala.util.control.NonFatal(restore) => restore.printStackTrace()

  def run(steps: Seq[ReleaseStep]): Unit =
    steps.foreach: step =>
      val aborted = abortedAt(step)
      addShutdownHook(aborted)
      try run(step)
      catch
        // whatever ended the step - a fatal error too (best effort then): it stays the error,
        // a failing restore or report is added to it
        case e: Throwable => // intentional: the restore for a fatal error too, then it goes on
          onFailureOf(step, e)
          if e.isInstanceOf[InterruptedException] then Thread.currentThread().interrupt() // the flag survives
          throw e
      finally
        // refused while the JVM shuts down - then the hook runs anyway
        try removeShutdownHook(aborted)
        catch case _: IllegalStateException => ()

  /** The step failed with `e`: the restore first, then (an upload) what went out - the report
    * is best effort and may take a while.
    */
  private def onFailureOf(step: ReleaseStep, e: Throwable): Unit =
    suppressedBy(e)(onFailure(step)) // nothing for the git step - see RestoreForRetry
    if step == ReleaseStep.Git then
      println(
        "The git step failed - the version is uploaded and released. Finish by hand what is left: the " +
          "commit of the release, the tag `v<version>`, the merge into master, the next SNAPSHOT version " +
          "on develop, the push of both branches and the tag. The working tree is left as it is."
      )
    if step == ReleaseStep.Upload then
      if isSnapshot then println("The upload of the snapshot failed - a snapshot is overwritable, run it again.")
      else
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


/** `body` after a failure `e` - fails it too (whatever the failure: the restore is best effort,
  * `e` is what to look at), that is added to `e`, which stays the error.
  */
private[publish] def suppressedBy(e: Throwable)(body: => Unit): Unit =
  try body
  catch case r: Throwable => if r ne e then e.addSuppressed(r)
