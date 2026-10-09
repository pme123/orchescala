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

  test("the remote gone, the clone there: it serves the docs as it is; initProject fails as before"):
    val gitTemp = os.temp.dir(prefix = "git-temp")
    val clone   = gitTemp / "orchescala-acme"
    os.write(clone / ".gitignore", "target/\n", createFolders = true)
    os.write(clone / "projects" / "acme-shop" / "PROJECT.conf", "name = acme-shop\n", createFolders = true)
    git(clone, "init", "-q")
    git(clone, "add", ".")
    git(clone, "commit", "-q", "-m", "projects")
    val repoConfig = ProjectsPerGitRepoConfig(
      cloneBaseUrl = (os.temp.dir(prefix = "remotes") / "none").toString,
      projects = Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))),
      singleRepo = true
    )
    val out     = java.io.ByteArrayOutputStream()
    Console.withOut(out)(ProjectsConfig(perGitRepoConfigs = Seq(repoConfig)).updateSingleRepoClone("acme-shop", gitTemp, "acme"))
    assert(out.toString.contains("not updated"), out.toString)
    Console.withOut(java.io.ByteArrayOutputStream()):
      intercept[Exception](repoConfig.initProject(gitTemp, "acme-shop", "acme"))

  test("the docs' pull of the company clone never prompts: an origin asking for a login fails at once"):
    // an origin that wants credentials - on the console git would ask for them and wait
    val server  = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/", exchange =>
      exchange.getResponseHeaders.add("WWW-Authenticate", "Basic realm=\"acme\"")
      exchange.sendResponseHeaders(401, -1)
      exchange.close()
    )
    server.start()
    try
      val gitTemp = os.temp.dir(prefix = "git-temp")
      val clone   = gitTemp / "orchescala-acme"
      os.write(clone / ".gitignore", "target/\n", createFolders = true)
      os.write(clone / "projects" / "acme-shop" / "PROJECT.conf", "name = acme-shop\n", createFolders = true)
      git(clone, "init", "-q")
      git(clone, "add", ".")
      git(clone, "commit", "-q", "-m", "projects")
      git(clone, "remote", "add", "origin", s"http://127.0.0.1:${server.getAddress.getPort}/orchescala-acme.git")
      // no credential helper of the machine in between; an askpass program that would wait for a login
      git(clone, "config", "credential.helper", "")
      val askPass = gitTemp / "ask.sh"
      os.write(askPass, "#!/bin/sh\nsleep 120\n", perms = "rwxr-xr-x")
      git(clone, "config", "core.askPass", askPass.toString)
      val config  = ProjectsConfig(perGitRepoConfigs = Seq(ProjectsPerGitRepoConfig(
        cloneBaseUrl = s"http://127.0.0.1:${server.getAddress.getPort}",
        projects = Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))),
        singleRepo = true
      )))
      val out     = java.io.ByteArrayOutputStream()
      given ExecutionContext = ExecutionContext.global
      // asked, it would wait 2 minutes per prompt
      val update  = Future(blocking(Console.withOut(out)(config.updateSingleRepoClone("acme-shop", gitTemp, "acme"))))
      Await.result(update, 20.seconds)
      assert(out.toString.contains("not updated"), out.toString)
    finally server.stop(0)

  test("a clone killed midway (a .git, no commit) does not serve"):
    val gitTemp = os.temp.dir(prefix = "git-temp")
    val clone   = gitTemp / "orchescala-acme"
    os.makeDir.all(clone)
    git(clone, "init", "-q")
    os.write(clone / ".gitignore", "target/\n")
    val config  = ProjectsConfig(perGitRepoConfigs = Seq(ProjectsPerGitRepoConfig(
      cloneBaseUrl = (os.temp.dir(prefix = "remotes") / "none").toString,
      projects = Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))),
      singleRepo = true
    )))
    Console.withOut(java.io.ByteArrayOutputStream()):
      intercept[Exception](config.updateSingleRepoClone("acme-shop", gitTemp, "acme"))

  test("initProject (single repo) - a project not (yet) in the company repo: a clear error"):
    val remotes = os.temp.dir(prefix = "remotes")
    val work    = os.temp.dir(prefix = "work")
    os.write(work / ".gitignore", "target/\n")
    os.write(work / "projects" / "acme-shop" / "PROJECT.conf", "name = acme-shop\n", createFolders = true)
    git(work, "init", "-q")
    git(work, "add", ".")
    git(work, "commit", "-q", "-m", "projects")
    os.proc("git", "clone", "-q", "--bare", work.toString, (remotes / "orchescala-acme.git").toString)
      .call(stdout = os.Pipe, stderr = os.Pipe)
    val config  = ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-later", ProjectGroup("acme"))), singleRepo = true)
    val err     = Console.withOut(java.io.ByteArrayOutputStream()):
      intercept[Exception](config.initProject(os.temp.dir(prefix = "git-temp"), "acme-later", "acme"))
    assert(err.getMessage.contains("acme-later is not in the company repo"), err.getMessage)

  test("ProjectsConfig.initProject - one repo for all next to own repos: only the config with the project acts"):
    val remotes = os.temp.dir(prefix = "remotes")
    def bare(name: String, files: Map[String, String]) =
      val work = os.temp.dir(prefix = "work")
      os.write(work / ".gitignore", "target/\n")
      files.foreach((f, c) => os.write(work / os.RelPath(f), c, createFolders = true))
      git(work, "init", "-q")
      git(work, "add", ".")
      git(work, "commit", "-q", "-m", "init")
      os.proc("git", "clone", "-q", "--bare", work.toString, (remotes / s"$name.git").toString)
        .call(stdout = os.Pipe, stderr = os.Pipe)
    bare("orchescala-acme", Map("projects/acme-shop/PROJECT.conf" -> "name = acme-shop\n"))
    bare("acme-own", Map("PROJECT.conf" -> "name = acme-own\n"))
    val config  = ProjectsConfig(perGitRepoConfigs = Seq(
      ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))), singleRepo = true),
      ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-own", ProjectGroup("acme"))))
    ))
    val gitTemp = os.temp.dir(prefix = "git-temp")
    Console.withOut(java.io.ByteArrayOutputStream()):
      config.initProject("acme-own", gitTemp, "acme") // the single repo config does not know it: no error
      config.initProject("acme-shop", gitTemp, "acme")
    assertEquals(os.read(gitTemp / "acme-own" / "PROJECT.conf"), "name = acme-own\n")
    assert(os.exists(gitTemp / "acme-own" / ".git")) // its own clone
    assertEquals(os.read(gitTemp / "acme-shop" / "PROJECT.conf"), "name = acme-shop\n")

  test("init pulls every time, the docs' updateSingleRepoClone once per UpdateValidMs"):
    val remotes = os.temp.dir(prefix = "remotes")
    val work    = os.temp.dir(prefix = "work")
    os.write(work / ".gitignore", "target/\n")
    os.write(work / "projects" / "acme-shop" / "PROJECT.conf", "v1\n", createFolders = true)
    git(work, "init", "-q", "-b", "develop")
    git(work, "add", ".")
    git(work, "commit", "-q", "-m", "v1")
    os.proc("git", "clone", "-q", "--bare", work.toString, (remotes / "orchescala-acme.git").toString)
      .call(stdout = os.Pipe, stderr = os.Pipe)
    val repoConfig = ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))), singleRepo = true)
    val config     = ProjectsConfig(perGitRepoConfigs = Seq(repoConfig))
    val gitTemp    = os.temp.dir(prefix = "git-temp")
    def push(text: String) =
      os.write.over(work / "projects" / "acme-shop" / "PROJECT.conf", text)
      git(work, "commit", "-q", "-am", text.trim)
      git(work, "push", "-q", (remotes / "orchescala-acme.git").toString, "develop")
    def inClone = os.read(gitTemp / "orchescala-acme" / "projects" / "acme-shop" / "PROJECT.conf")
    Console.withOut(java.io.ByteArrayOutputStream()):
      config.updateSingleRepoClone("acme-shop", gitTemp, "acme")
      push("v2\n")
      config.updateSingleRepoClone("acme-shop", gitTemp, "acme") // within the window: no pull
      assertEquals(inClone, "v1\n")
      zio.Unsafe.unsafe { implicit u => zio.Runtime.default.unsafe.run(repoConfig.init(gitTemp, "acme")).getOrThrow() }
      assertEquals(inClone, "v2\n") // init pulled

  test("a company repo on main only (no develop): pulled from main; initProject replaces an existing copy"):
    val remotes = os.temp.dir(prefix = "remotes")
    val work    = os.temp.dir(prefix = "work")
    os.write(work / ".gitignore", "target/\n")
    os.write(work / "projects" / "acme-shop" / "PROJECT.conf", "v1\n", createFolders = true)
    git(work, "init", "-q", "-b", "main")
    git(work, "add", ".")
    git(work, "commit", "-q", "-m", "v1")
    os.proc("git", "clone", "-q", "--bare", work.toString, (remotes / "orchescala-acme.git").toString)
      .call(stdout = os.Pipe, stderr = os.Pipe)
    val repoConfig = ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-shop", ProjectGroup("acme"))), singleRepo = true)
    val gitTemp    = os.temp.dir(prefix = "git-temp")
    Console.withOut(java.io.ByteArrayOutputStream()):
      zio.Unsafe.unsafe { implicit u => zio.Runtime.default.unsafe.run(repoConfig.init(gitTemp, "acme")).getOrThrow() }
      os.write.over(work / "projects" / "acme-shop" / "PROJECT.conf", "v2\n")
      git(work, "commit", "-q", "-am", "v2")
      git(work, "push", "-q", (remotes / "orchescala-acme.git").toString, "main")
      os.write(gitTemp / "acme-shop" / "local.txt", "a local change in the copy")
      zio.Unsafe.unsafe { implicit u => zio.Runtime.default.unsafe.run(repoConfig.init(gitTemp, "acme")).getOrThrow() }
      repoConfig.initProject(gitTemp, "acme-shop", "acme")
    assertEquals(os.read(gitTemp / "acme-shop" / "PROJECT.conf"), "v2\n") // main pulled
    assert(!os.exists(gitTemp / "acme-shop" / "local.txt")) // the copy is the clone's - replaced

  test("an own repo on main only (no develop): init clones it, the next init pulls main"):
    val remotes = os.temp.dir(prefix = "remotes")
    val work    = os.temp.dir(prefix = "work")
    os.write(work / ".gitignore", "target/\n")
    os.write(work / "PROJECT.conf", "v1\n")
    git(work, "init", "-q", "-b", "main")
    git(work, "add", ".")
    git(work, "commit", "-q", "-m", "v1")
    os.proc("git", "clone", "-q", "--bare", work.toString, (remotes / "acme-own.git").toString)
      .call(stdout = os.Pipe, stderr = os.Pipe)
    val repoConfig = ProjectsPerGitRepoConfig(remotes.toString, Seq(ProjectConfig("acme-own", ProjectGroup("acme"))))
    val gitTemp    = os.temp.dir(prefix = "git-temp")
    def init() = zio.Unsafe.unsafe { implicit u => zio.Runtime.default.unsafe.run(repoConfig.init(gitTemp, "acme")).getOrThrow() }
    Console.withOut(java.io.ByteArrayOutputStream()):
      init()
      os.write.over(work / "PROJECT.conf", "v2\n")
      git(work, "commit", "-q", "-am", "v2")
      git(work, "push", "-q", (remotes / "acme-own.git").toString, "main")
      init()
    assertEquals(os.read(gitTemp / "acme-own" / "PROJECT.conf"), "v2\n")

  test("once - a failure after a success ends it: after the failure window the next caller updates"):
    val clone   = os.temp.dir(prefix = "clone")
    val updates = java.util.concurrent.atomic.AtomicInteger()
    ProjectsPerGitRepoConfig.once(clone, now = 0)(updates.incrementAndGet())
    // forced (e.g. the clone gone) and failing - the success before no longer counts
    intercept[Exception](ProjectsPerGitRepoConfig.once(clone, now = 1000, force = true)(throw new Exception("offline")))
    intercept[Exception](ProjectsPerGitRepoConfig.once(clone, now = 2000)(updates.incrementAndGet()))
    ProjectsPerGitRepoConfig.once(clone, now = 1000 + ProjectsPerGitRepoConfig.FailedUpdateValidMs)(updates.incrementAndGet())
    assertEquals(updates.get, 2) // pulled again, not «done 5 min ago»
    assertEquals(ProjectsPerGitRepoConfig.updateFailure(clone), None)

  test("once - force (the clone gone) updates within UpdateValidMs too"):
    val clone   = os.temp.dir(prefix = "clone")
    val updates = java.util.concurrent.atomic.AtomicInteger()
    ProjectsPerGitRepoConfig.once(clone, now = 0)(updates.incrementAndGet())
    ProjectsPerGitRepoConfig.once(clone, now = 1)(updates.incrementAndGet())
    ProjectsPerGitRepoConfig.once(clone, now = 2, force = true)(updates.incrementAndGet())
    assertEquals(updates.get, 2)

  test("once - a caller at the same time waits for the running update, then does not update again"):
    val clone   = os.temp.dir(prefix = "clone")
    val started = java.util.concurrent.CountDownLatch(1)
    val release = java.util.concurrent.CountDownLatch(1)
    val updates = java.util.concurrent.atomic.AtomicInteger()
    val first   = Thread(() =>
      ProjectsPerGitRepoConfig.once(clone):
        updates.incrementAndGet()
        started.countDown()
        release.await()
    )
    first.start()
    started.await()
    val secondDone = java.util.concurrent.atomic.AtomicBoolean(false)
    val second  = Thread(() => { ProjectsPerGitRepoConfig.once(clone)(updates.incrementAndGet()); secondDone.set(true) })
    second.start()
    // it is parked on the lock (not merely slow): its state says so
    val deadline = System.currentTimeMillis + 5000
    while second.getState != Thread.State.WAITING && System.currentTimeMillis < deadline do Thread.sleep(10)
    assertEquals(second.getState, Thread.State.WAITING)
    assert(!secondDone.get) // waits for the first
    release.countDown()
    first.join(5000)
    second.join(5000)
    assert(secondDone.get)
    assertEquals(updates.get, 1)

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
    assert(config.inSingleRepo("acme-shop") && !config.inSingleRepo("acme-own"))
    Console.withOut(java.io.ByteArrayOutputStream()):
      config.updateSingleRepoClone("acme-shop", gitTemp, "acme")
      config.updateSingleRepoClone("acme-own", gitTemp, "acme") // an own repo: nothing
    assert(os.exists(gitTemp / "orchescala-acme" / ".git"))
    assert(!os.exists(gitTemp / "acme-shop")) // no copy - the docs export the folder at its tag

  test("once - an update counts UpdateValidMs, then the next run updates again"):
    val clone   = os.temp.dir(prefix = "clone")
    val updates = java.util.concurrent.atomic.AtomicInteger()
    ProjectsPerGitRepoConfig.once(clone, now = 1000)(updates.incrementAndGet())
    ProjectsPerGitRepoConfig.once(clone, now = 1000 + ProjectsPerGitRepoConfig.UpdateValidMs - 1)(updates.incrementAndGet())
    assertEquals(updates.get, 1)
    ProjectsPerGitRepoConfig.once(clone, now = 1000 + ProjectsPerGitRepoConfig.UpdateValidMs)(updates.incrementAndGet())
    assertEquals(updates.get, 2)
    // a failed update: the same failure for FailedUpdateValidMs (not another pull per project), then again
    val other = os.temp.dir(prefix = "clone")
    intercept[Exception](ProjectsPerGitRepoConfig.once(other, now = 0)(throw new Exception("no network")))
    val again = intercept[CloneUpdateFailed](ProjectsPerGitRepoConfig.once(other, now = 1)(updates.incrementAndGet()))
    assertEquals((again.getCause.getMessage, updates.get), ("no network", 2))
    ProjectsPerGitRepoConfig.once(other, now = ProjectsPerGitRepoConfig.FailedUpdateValidMs)(updates.incrementAndGet())
    assertEquals(updates.get, 3)
    assertEquals(ProjectsPerGitRepoConfig.updateFailure(other), None) // it worked again
    intercept[Exception](ProjectsPerGitRepoConfig.once(other, now = 10 * ProjectsPerGitRepoConfig.UpdateValidMs)(throw new Exception("offline")))
    assertEquals(ProjectsPerGitRepoConfig.updateFailure(other), Some("offline"))

end ProjectsPerGitRepoConfigTest
