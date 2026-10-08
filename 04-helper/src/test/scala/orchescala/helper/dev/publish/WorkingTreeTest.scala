package orchescala.helper.dev.publish

import munit.FunSuite

/** The working tree of a failed release - restored for the next try. */
class WorkingTreeTest extends FunSuite:

  /** A git repository with one committed file and a CHANGELOG. */
  private def repo(): os.Path =
    val dir = os.temp.dir(prefix = "orchescala-retry-")
    def git(args: String*) = os.proc("git" +: args).call(cwd = dir)
    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "test")
    os.write(dir / "build.sbt", "version := \"1.0.0\"")
    os.write(dir / "ProjectDef.scala", "version = \"1.0.0\"")
    os.write(dir / "CHANGELOG.md", "# Changelog")
    git("add", ".")
    git("commit", "-q", "-m", "init")
    dir


  /** The version is rewritten, then the build fails: the next try must pass the clean-tree check. */
  test("a failed release restores the versions it rewrote - the CHANGELOG and untracked files stay"):
    val dir = repo()
    // a generated doc with a special name - `--porcelain` would quote it
    os.write(dir / "docs" / "Prozess Ü (1).md", "# v1", createFolders = true)
    os.proc("git", "add", ".").call(cwd = dir)
    os.proc("git", "commit", "-q", "-m", "doc").call(cwd = dir)
    os.write.over(dir / "CHANGELOG.md", "# Changelog\n## 1.1.0")
    os.write(dir / "notes.txt", "not tracked")
    WorkingTree.verifyCleanWorkingTree(dir)
    // as publish does: armed with the clean tree, then the release rewrites the files
    val restore = WorkingTree.restoreForRetry(isSnapshot = false, dir)
    os.remove(dir / "build.sbt") // a generator removed a file
    os.write(dir / "new.md", "added during the release")
    os.proc("git", "mv", "docs/Prozess Ü (1).md", "docs/renamed.md").call(cwd = dir) // a rename, staged
    os.write.over(dir / "docs" / "renamed.md", "# v2 generated")
    PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
    os.proc("git", "add", "ProjectDef.scala", "new.md").call(cwd = dir) // staged or not, even a new file
    intercept[IllegalStateException](WorkingTree.verifyCleanWorkingTree(dir))

    val runs = SbtRuns.of(None)
    val rel  = ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = _ => throw IllegalStateException("sbt failed"),
      onFailure = restore
    )
    intercept[IllegalStateException](rel.run(ReleaseRun.steps(isSnapshot = false, hasDocs = true)))

    WorkingTree.verifyCleanWorkingTree(dir) // the next try starts clean
    assertEquals(os.read(dir / "ProjectDef.scala"), "version = \"1.0.0\"")
    assertEquals(os.read(dir / "docs" / "Prozess Ü (1).md"), "# v1")
    assertEquals(os.read(dir / "build.sbt"), "version := \"1.0.0\"")
    assert(os.exists(dir / "new.md")) // unstaged, kept as untracked
    assert(os.exists(dir / "docs" / "renamed.md")) // the rename's target: unstaged, kept as untracked
    assertEquals(os.read(dir / "CHANGELOG.md"), "# Changelog\n## 1.1.0")
    assert(os.exists(dir / "notes.txt"))


  /** Ctrl-C: the failing sbt run and the shutdown hook both ask for the restore - it runs once,
    * the second caller waits for it (the JVM ends with the hook).
    */
  test("the restore runs once - a concurrent second call waits for it"):
    val dir     = repo()
    var runs    = 0
    val inside  = java.util.concurrent.CountDownLatch(1) // the first restore is running
    val release = java.util.concurrent.CountDownLatch(1) // ... and may end
    val restore = WorkingTree.restoreForRetry(
      isSnapshot = false,
      dir,
      restore = _ =>
        runs += 1
        inside.countDown()
        release.await()
    )
    val first   = Thread(() => restore(ReleaseStep.Build))
    first.start()
    inside.await()
    @volatile var secondDone = false
    val second  = Thread: () =>
      restore(ReleaseStep.Build) // the hook - waits for the first, then nothing to do
      secondDone = true
    second.start()
    Thread.sleep(100)
    assert(!secondDone, "the second waits while the first runs")
    release.countDown()
    first.join()
    second.join()
    assert(secondDone)
    assertEquals(runs, 1)
    restore(ReleaseStep.Build) // a third call: done already
    assertEquals(runs, 1)


  test("a failing restore is tried again by the next caller (the hook)"):
    val dir   = repo()
    var calls = 0
    val restore = WorkingTree.restoreForRetry(
      isSnapshot = false,
      dir,
      restore = _ =>
        calls += 1
        if calls == 1 then throw IllegalStateException("index.lock")
    )
    intercept[IllegalStateException](restore(ReleaseStep.Build))
    restore(ReleaseStep.Build) // the hook: tries again
    restore(ReleaseStep.Build) // done now
    assertEquals(calls, 2)


  test("a failing rewrite before the release restores too"):
    val dir     = repo()
    val restore = WorkingTree.restoreForRetry(isSnapshot = false, dir)
    val error   = intercept[IllegalStateException]:
      WorkingTree.restoring(restore):
        PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
        throw IllegalStateException("the api file is broken")
    assertEquals(error.getMessage, "the api file is broken")
    WorkingTree.verifyCleanWorkingTree(dir)


  test("with changes of yours in the tree the restore is not armed - whatever the caller checked"):
    val dir = repo()
    os.write.over(dir / "ProjectDef.scala", "version = \"1.0.0\" // my unfinished work")
    val restore = WorkingTree.restoreForRetry(isSnapshot = false, dir) // armed with a dirty tree
    PublishHelper.replaceVersion("1.1.0", dir / "ProjectDef.scala")
    restore(ReleaseStep.Build)
    // nothing discarded - neither the rewritten version nor the unfinished work
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0\" // my unfinished work")


  test("a failing restore does not hide the failure of the release"):
    val runs = SbtRuns.of(None)
    val rel  = ReleaseRun(
      runs,
      uploadDocs = () => (),
      git = () => (),
      exec = _ => throw IllegalStateException("sbt failed"),
      onFailure = _ => throw IllegalArgumentException("restore failed")
    )
    val error = intercept[IllegalStateException](rel.run(ReleaseRun.steps(isSnapshot = true, hasDocs = false)))
    assertEquals(error.getSuppressed.toSeq.map(_.getMessage), Seq("restore failed"))


  test("a snapshot keeps its changes; after the git step nothing is restored"):
    val dir = repo()
    PublishHelper.replaceVersion("1.1.0-SNAPSHOT", dir / "ProjectDef.scala")
    WorkingTree.restoreForRetry(isSnapshot = true, dir)(ReleaseStep.Build)
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0-SNAPSHOT\"")
    WorkingTree.restoreForRetry(isSnapshot = false, dir)(ReleaseStep.Git)
    assertEquals(os.read(dir / "ProjectDef.scala").trim, "version = \"1.1.0-SNAPSHOT\"")

end WorkingTreeTest
