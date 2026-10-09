package orchescala.api

import munit.FunSuite

import scala.concurrent.*
import scala.concurrent.duration.*

/** The single repo of a company in git-temp: initProject clones it once (a local «remote»), then copies
  * the project out of it - also when the projects come in parallel.
  */
class ProjectsPerGitRepoConfigTest extends FunSuite:

  private def git(dir: os.Path, args: String*): Unit =
    os.proc("git", "-c", "user.name=test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", args)
      .call(cwd = dir, stdout = os.Pipe, stderr = os.Pipe)

  test("initProject (single repo) - one clone of orchescala-<company>, the project copied from it"):
    val remotes = os.temp.dir(prefix = "remotes")
    val work    = os.temp.dir(prefix = "work")
    os.write(work / ".gitignore", "target/\n")
    for p <- Seq("acme-shop", "acme-cards", "acme-new") do
      os.write(work / "projects" / p / "PROJECT.conf", s"name = $p\n", createFolders = true)
    git(work, "init", "-q")
    git(work, "add", ".")
    git(work, "commit", "-q", "-m", "projects")
    os.proc("git", "clone", "-q", "--bare", work.toString, (remotes / "orchescala-acme.git").toString)
      .call(stdout = os.Pipe, stderr = os.Pipe)
    val config  = ProjectsPerGitRepoConfig(
      cloneBaseUrl = remotes.toString,
      projects = Seq("acme-shop", "acme-cards", "acme-new").map(ProjectConfig(_, ProjectGroup("acme"))),
      singleRepo = true
    )
    val gitTemp = os.temp.dir(prefix = "git-temp")
    val pool    = ExecutionContext.fromExecutorService(java.util.concurrent.Executors.newFixedThreadPool(3))
    given ExecutionContext = pool
    try
      Await.result(
        Future.sequence(Seq("acme-shop", "acme-cards", "acme-new").map: p =>
          Future(blocking(Console.withOut(java.io.ByteArrayOutputStream())(config.initProject(gitTemp, p, "acme"))))),
        2.minutes
      )
    finally pool.shutdown()
    assert(os.exists(gitTemp / "orchescala-acme" / ".git"))
    assert(!os.exists(gitTemp / "acme")) // not the old place
    for p <- Seq("acme-shop", "acme-cards", "acme-new") do
      assertEquals(os.read(gitTemp / p / "PROJECT.conf"), s"name = $p\n")
      assert(!os.exists(gitTemp / p / ".git")) // a copy - the history is the company clone's

  test("initProject (single repo) - a remote that is not there: an error, nothing copied"):
    val config  = ProjectsPerGitRepoConfig(
      cloneBaseUrl = (os.temp.dir(prefix = "remotes") / "none").toString,
      projects = Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))),
      singleRepo = true
    )
    val gitTemp = os.temp.dir(prefix = "git-temp")
    intercept[Exception]:
      Console.withOut(java.io.ByteArrayOutputStream())(config.initProject(gitTemp, "acme-shop", "acme"))
    assert(!os.exists(gitTemp / "acme-shop"))

  test("initProject (single repo) - the remote gone, the clone there: it serves as it is"):
    val gitTemp = os.temp.dir(prefix = "git-temp")
    val clone   = gitTemp / "orchescala-acme"
    os.write(clone / ".gitignore", "target/\n", createFolders = true)
    os.write(clone / "projects" / "acme-shop" / "PROJECT.conf", "name = acme-shop\n", createFolders = true)
    git(clone, "init", "-q")
    git(clone, "add", ".")
    git(clone, "commit", "-q", "-m", "projects")
    val config  = ProjectsPerGitRepoConfig(
      cloneBaseUrl = (os.temp.dir(prefix = "remotes") / "none").toString,
      projects = Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))),
      singleRepo = true
    )
    val out     = java.io.ByteArrayOutputStream()
    Console.withOut(out)(config.initProject(gitTemp, "acme-shop", "acme"))
    assert(out.toString.contains("not updated"), out.toString)
    assertEquals(os.read(gitTemp / "acme-shop" / "PROJECT.conf"), "name = acme-shop\n")

  test("updateSingleRepoClone - only for a project in one repo for all, only the clone"):
    val remotes = os.temp.dir(prefix = "remotes")
    val work    = os.temp.dir(prefix = "work")
    os.write(work / ".gitignore", "target/\n")
    os.write(work / "projects" / "acme-shop" / "PROJECT.conf", "name = acme-shop\n", createFolders = true)
    git(work, "init", "-q")
    git(work, "add", ".")
    git(work, "commit", "-q", "-m", "projects")
    os.proc("git", "clone", "-q", "--bare", work.toString, (remotes / "orchescala-acme.git").toString)
      .call(stdout = os.Pipe, stderr = os.Pipe)
    val config  = ProjectsConfig(perGitRepoConfigs = Seq(
      ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))), singleRepo = true),
      ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-own", ProjectGroup("acme"))))
    ))
    val gitTemp = os.temp.dir(prefix = "git-temp")
    Console.withOut(java.io.ByteArrayOutputStream()):
      assert(config.updateSingleRepoClone("acme-shop", gitTemp, "acme"))
      assert(!config.updateSingleRepoClone("acme-own", gitTemp, "acme"))
    assert(os.exists(gitTemp / "orchescala-acme" / ".git"))
    assert(!os.exists(gitTemp / "acme-shop")) // no copy - the docs export the folder at its tag

  test("once - an update counts UpdateValidMs, then the next run updates again"):
    val clone   = os.temp.dir(prefix = "clone")
    var updates = 0
    ProjectsPerGitRepoConfig.once(clone, now = 1000)(updates += 1)
    ProjectsPerGitRepoConfig.once(clone, now = 1000 + ProjectsPerGitRepoConfig.UpdateValidMs - 1)(updates += 1)
    assertEquals(updates, 1)
    ProjectsPerGitRepoConfig.once(clone, now = 1000 + ProjectsPerGitRepoConfig.UpdateValidMs)(updates += 1)
    assertEquals(updates, 2)
    // a failed update is tried again at once
    val other = os.temp.dir(prefix = "clone")
    intercept[Exception](ProjectsPerGitRepoConfig.once(other, now = 0)(throw new Exception("no network")))
    ProjectsPerGitRepoConfig.once(other, now = 1)(updates += 1)
    assertEquals(updates, 3)

end ProjectsPerGitRepoConfigTest
