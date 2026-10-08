package orchescala.helper.dev.publish

import munit.FunSuite

/** The steps of a release, the sbt runs, the shutdown hook and the sbt child. */
class ReleaseRunTest extends FunSuite:


  test("a release builds everything locally first - the upload is the last sbt run"):
    val runs = SbtRuns.of(dockerProject = Some("worker"), build = Seq("api/run"))
    assertEquals(
      runs.build,
      Seq("sbt", "package", "packageSrc", "makePom", "worker / Docker / publishLocal", "api/run")
    )
    // the image first - its tag can be overwritten, the artifacts of a release can not
    assertEquals(runs.publish, Seq("sbt", "worker / Docker / publish", "publish"))

  test("without a docker image - and with sbt options"):
    val runs = SbtRuns.of(dockerProject = None, sbtOptions = Seq("-J-Xmx3G"))
    assertEquals(runs.build, Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom"))
    assertEquals(runs.publish, Seq("sbt", "-J-Xmx3G", "publish"))

  test("the steps of a release: build, the docs, the upload, git - a snapshot only builds and uploads"):
    import ReleaseStep.*
    assertEquals(
      ReleaseRun.steps(isSnapshot = false, hasDocs = true),
      Seq(Build, UploadDocs, Upload, Git)
    )
    assertEquals(
      ReleaseRun.steps(isSnapshot = false, hasDocs = false),
      Seq(Build, Upload, Git)
    )
    assertEquals(ReleaseRun.steps(isSnapshot = true, hasDocs = true), Seq(Build, Upload))

  /** A release whose processes are recorded instead of run - `failing` throws; a failure is
    * recorded as `failed <step>`.
    */
  private def release(failing: Set[String] = Set.empty): (ReleaseRun, () => Seq[String]) =
    val log  = collection.mutable.ListBuffer.empty[String]
    def step(name: String): Unit =
      log += name
      if failing(name) then throw IllegalStateException(s"$name failed")
    val runs = SbtRuns.of(Some("worker"))
    val rel  = ReleaseRun(
      runs,
      uploadDocs = () => step("docs"),
      git = () => step("git"),
      exec = cmd => step(if cmd == runs.build then "build" else "upload"),
      onFailure = failed => log += s"failed $failed",
      afterFailedUpload = () => log += "reported"
    )
    (rel, () => log.toSeq)

  test("the release runs its steps in order"):
    val (rel, log) = release()
    rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "upload", "git"))
    val (snapshot, snapshotLog) = release()
    snapshot.run(ReleaseRun.steps(isSnapshot = true, hasDocs = true))
    assertEquals(snapshotLog(), Seq("build", "upload"))

  test("a failing build stops the release - nothing is uploaded"):
    val (rel, log) = release(failing = Set("build"))
    intercept[IllegalStateException]:
      rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "failed Build"))

  test("failing docs stop the release - nothing is uploaded"):
    val (rel, log) = release(failing = Set("docs"))
    intercept[IllegalStateException]:
      rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "failed UploadDocs"))

  test("a failing upload: the docs are on the webserver already, git does not run - what went out is reported"):
    val (rel, log) = release(failing = Set("upload"))
    intercept[IllegalStateException]:
      rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true))
    assertEquals(log(), Seq("build", "docs", "upload", "failed Upload", "reported")) // the restore first
    // the hook of the same step (Ctrl-C) does not report again
    rel.abortedAt(ReleaseStep.Upload).run()
    assertEquals(log().count(_ == "reported"), 1)

  test("the runs of a project and of the company project"):
    assertEquals(
      SbtRuns.project(hasWorkerApp = true).build,
      Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom", "worker / Docker / publishLocal", "api/run")
    )
    assertEquals(
      SbtRuns.project(hasWorkerApp = false).publish,
      Seq("sbt", "-J-Xmx3G", "publish")
    )
    assertEquals(
      SbtRuns.company(hasGateway = true).publish,
      Seq("sbt", "-J-Xmx3G", "gateway / Docker / publish", "publish")
    )
    assertEquals(
      SbtRuns.company(hasGateway = false).build,
      Seq("sbt", "-J-Xmx3G", "package", "packageSrc", "makePom")
    )
    // the options come from the company's SbtConfig - a runner with less memory
    assertEquals(SbtRuns.project(hasWorkerApp = false, Seq("-J-Xmx1G")).publish, Seq("sbt", "-J-Xmx1G", "publish"))
    assertEquals(SbtRuns.company(hasGateway = false, Seq.empty).publish, Seq("sbt", "publish"))

  test("an interrupt or a fatal error restores too - best effort - and goes through"):
    def interrupted(error: Throwable): Seq[String] =
      val log  = collection.mutable.ListBuffer.empty[String]
      val runs = SbtRuns.of(None)
      val rel  = ReleaseRun(
        runs,
        uploadDocs = () => (),
        git = () => (),
        exec = _ => throw error,
        onFailure = step => log += s"failed $step"
      )
      // munit's intercept lets a fatal error through (and interrupts the thread) - caught by hand
      try rel.run(ReleaseRun.steps(isSnapshot = true, hasDocs = false))
      catch case e: Throwable => assertEquals(e, error)
      Thread.interrupted() // clears the flag, should one have been set
      log.toSeq
    assertEquals(interrupted(InterruptedException("Ctrl-C")), Seq("failed Build"))
    assertEquals(interrupted(OutOfMemoryError("sbt")), Seq("failed Build"))
    assertEquals(interrupted(IllegalStateException("sbt failed")), Seq("failed Build"))


  /** Ctrl-C ends the JVM: the shutdown hook of the running step restores - it is registered
    * while the step runs and gone afterwards (a hook of a finished step would restore the
    * next try's work).
    */
  test("the shutdown hook of the running step restores it - and is gone once the step is done"):
    val hooks   = collection.mutable.Set.empty[Thread]
    val log     = collection.mutable.ListBuffer.empty[String]
    val runs    = SbtRuns.of(None)
    var during  = Seq.empty[Thread]
    val rel     = ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = cmd => if cmd == runs.build then during = hooks.toSeq,
      onFailure = step => log += s"restored $step",
      awaitChild = () => log += "waited for sbt",
      addShutdownHook = hooks += _,
      removeShutdownHook = hooks -= _
    )
    rel.run(ReleaseRun.steps(isSnapshot = true, hasDocs = false))
    assertEquals(during.size, 1) // the hook of Build, while it ran
    assert(hooks.isEmpty)        // gone afterwards
    during.head.run()            // as the JVM would on Ctrl-C
    assertEquals(log.toSeq, Seq("waited for sbt", "restored Build"))
    // aborted while uploading: what went out is reported, then restored
    log.clear()
    rel.copy(afterFailedUpload = () => log += "reported").abortedAt(ReleaseStep.Upload).run()
    assertEquals(log.toSeq, Seq("waited for sbt", "restored Upload", "reported")) // the restore first


  test("the sbt child: a failing process throws, a running one is waited for"):
    assume(!scala.util.Properties.isWin, "sh, sleep and pgrep")
    intercept[IllegalStateException](SbtChild.run(Seq("false")))
    SbtChild.run(Seq("true"))
    SbtChild.awaitExit() // nothing running - returns at once
    val sleeper = Thread(() => SbtChild.run(Seq("sleep", "1")))
    sleeper.start()
    Thread.sleep(200)
    val started = System.nanoTime()
    SbtChild.awaitExit()
    assert((System.nanoTime() - started) / 1e6 > 500, "waited for the child")
    sleeper.join()

  // the long sleeps are never waited for - they are killed; the odd durations are what pgrep looks for

  test("the sbt child and what it started are killed when the thread running it is interrupted"):
    assume(!scala.util.Properties.isWin, "sh, sleep and pgrep")
    @volatile var interrupted = false
    // a shell with a child of its own - like the sbt launcher and its JVM
    val runner = Thread: () =>
      try SbtChild.run(Seq("sh", "-c", "sleep 31.7; echo done"))
      catch case _: InterruptedException => interrupted = true
    runner.start()
    Thread.sleep(500)
    assertEquals(os.proc("pgrep", "-f", "^sleep 31.7$").call(check = false).exitCode, 0, "the grandchild runs")
    runner.interrupt()
    runner.join(10000)
    assert(!runner.isAlive, "the run ended with the interrupt")
    assert(interrupted)
    // gone within a few seconds (a killed process stays a zombie until it is reaped)
    def gone = os.proc("pgrep", "-fl", "^sleep 31.7$").call(check = false)
    val deadline = System.nanoTime() + 3_000_000_000L
    while gone.exitCode == 0 && System.nanoTime() < deadline do Thread.sleep(100)
    assertEquals(gone.exitCode, 1, s"the grandchild is gone: ${gone.out.text()}")
    val started = System.nanoTime()
    SbtChild.awaitExit() // nothing running any more
    assert((System.nanoTime() - started) / 1e6 < 1000)


  test("the exit code of a failed sbt run is in the message"):
    assume(!scala.util.Properties.isWin, "sh")
    val error = intercept[IllegalStateException](SbtChild.run(Seq("sh", "-c", "exit 3")))
    assert(error.getMessage.contains("exit code 3"), error.getMessage)


  test("one sbt run at a time"):
    assume(!scala.util.Properties.isWin, "sleep")
    val sleeper = Thread(() => SbtChild.run(Seq("sleep", "1")))
    sleeper.start()
    Thread.sleep(200)
    val error = intercept[IllegalStateException](SbtChild.run(Seq("true")))
    assert(error.getMessage.contains("going on already"), error.getMessage)
    sleeper.join()


  test("awaitExit ends sbt and what it started after its timeout - Ctrl-C, sbt still writing"):
    assume(!scala.util.Properties.isWin, "sh, sleep and pgrep")
    @volatile var failed = false
    val sleeper = Thread: () =>
      try SbtChild.run(Seq("sh", "-c", "sleep 33.1; echo done"))
      catch case _: IllegalStateException => failed = true // ended: exit code != 0
    sleeper.start()
    Thread.sleep(500)
    assertEquals(os.proc("pgrep", "-f", "^sleep 33.1$").call(check = false).exitCode, 0, "the grandchild runs")
    val started = System.nanoTime()
    SbtChild.awaitExit(timeout = scala.concurrent.duration.Duration(300, "millis"))
    val waited = (System.nanoTime() - started) / 1e6
    assert(waited >= 250 && waited < 6000, s"waited $waited ms")
    sleeper.join(5000)
    assert(failed)
    def gone = os.proc("pgrep", "-fl", "^sleep 33.1$").call(check = false)
    val deadline = System.nanoTime() + 3_000_000_000L
    while gone.exitCode == 0 && System.nanoTime() < deadline do Thread.sleep(100)
    assertEquals(gone.exitCode, 1, s"the grandchild is gone: ${gone.out.text()}")

end ReleaseRunTest
