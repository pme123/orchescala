package orchescala.helper.dev.company.docs.site

import munit.FunSuite

/** A project in git-temp: its own clone, or a company's single repo with the projects under
  * `projects/` and tags per project (`<project>-v<version>`).
  */
class ProjectRepoTest extends FunSuite:

  // a pool of its own for the parallel tests: git blocks, the global pool may be small on CI
  private lazy val pool = scala.concurrent.ExecutionContext.fromExecutorService(
    java.util.concurrent.Executors.newFixedThreadPool(8)
  )
  override def afterAll(): Unit = pool.shutdown()

  import GitTempFixture.*

  test("locate - a project in the company's single repo, with its folder as prefix"):
    val gitTemp = singleRepoGitTemp()
    val shop    = ProjectRepo.locate(gitTemp, "acme-shop").get
    assert(shop.singleRepo)
    assertEquals(shop.repo, gitTemp / "orchescala-acme")
    assertEquals(shop.path("03-api/OpenApi.yml"), "projects/acme-shop/03-api/OpenApi.yml")
    assertEquals(ProjectRepo.locate(gitTemp, "acme-unknown"), None)

  test("locate - a project with its own clone"):
    val gitTemp = os.temp.dir(prefix = "git-temp")
    os.write(gitTemp / "acme-own" / "README.md", "own", createFolders = true)
    git(gitTemp / "acme-own", "init", "-q")
    val own = ProjectRepo.locate(gitTemp, "acme-own").get
    assert(!own.singleRepo)
    assertEquals(own.tagCandidates("1.2.3"), Seq("v1.2.3", "1.2.3"))

  test("resolveTag - the project's own tag in the single repo; none for a version never released"):
    val shop = ProjectRepo.locate(singleRepoGitTemp(), "acme-shop").get
    assertEquals(shop.tagCandidates("1.0.0").head, "acme-shop-v1.0.0")
    assertEquals(shop.resolveTag("1.0.0"), Some("acme-shop-v1.0.0"))
    assertEquals(shop.resolveTag("2.0.0"), None)

  test("exportTo - only the project's folder, as it was at the tag"):
    val gitTemp = singleRepoGitTemp()
    val shop    = ProjectRepo.locate(gitTemp, "acme-shop").get
    val dest    = gitTemp / "acme-shop"
    os.write(dest / "stale.txt", "from before", createFolders = true)
    shop.exportTo("acme-shop-v1.0.0", dest)
    assertEquals(os.read(dest / "03-api" / "OpenApi.yml"), "version: 1.0.0\n")
    assert(os.exists(dest / "src" / "main" / "resources" / "camunda" / "shop.bpmn"))
    assert(!os.exists(dest / "stale.txt"))
    assert(!os.exists(dest / "projects"))
    assert(!os.exists(dest / "acme-cards"))

  test("exportRelease - the project's folder at its release tag; None for an own clone"):
    val gitTemp = singleRepoGitTemp()
    assertEquals(ProjectRepo.exportRelease(gitTemp, "acme-shop", "1.0.0", gitTemp / "acme-shop"), Some("acme-shop-v1.0.0"))
    assertEquals(os.read(gitTemp / "acme-shop" / "03-api" / "OpenApi.yml"), "version: 1.0.0\n")
    val own = os.temp.dir(prefix = "git-temp")
    os.write(own / "acme-own" / "README.md", "own", createFolders = true)
    git(own / "acme-own", "init", "-q")
    assertEquals(ProjectRepo.exportRelease(own, "acme-own", "1.0.0", own / "acme-own"), None)

  test("exportRelease - no tag for the version, or the project not there at the tag: an error, nothing emptied"):
    val gitTemp = singleRepoGitTemp()
    os.write(gitTemp / "acme-shop" / "keep.txt", "kept", createFolders = true)
    intercept[Exception](ProjectRepo.exportRelease(gitTemp, "acme-shop", "9.9.9", gitTemp / "acme-shop"))
    val newOne = ProjectRepo.locate(gitTemp, "acme-new").get
    intercept[Exception](newOne.exportTo("acme-shop-v1.0.0", gitTemp / "acme-new"))
    assert(os.exists(gitTemp / "acme-shop" / "keep.txt"))

  test("exportTo - never empties the clone itself"):
    val gitTemp = singleRepoGitTemp()
    val shop    = ProjectRepo.locate(gitTemp, "acme-shop").get
    intercept[Exception](shop.exportTo("acme-shop-v1.0.0", gitTemp))
    intercept[Exception](shop.exportTo("acme-shop-v1.0.0", shop.repo))
    assert(os.exists(shop.repo / ".git"))

  test("exportTo - git archive fails (a file of the tree is gone): git's error, dest kept, no leftovers"):
    val gitTemp = singleRepoGitTemp()
    val repo    = gitTemp / "orchescala-acme"
    val dest    = gitTemp / "acme-shop"
    os.write(dest / "keep.txt", "kept", createFolders = true)
    // the folder is there at the tag (existsAt), but a blob of it is missing - git archive fails midway
    val blob = os.proc("git", "rev-parse", "acme-shop-v1.0.0:projects/acme-shop/03-api/OpenApi.yml")
      .call(cwd = repo).out.text().trim
    os.remove(repo / ".git" / "objects" / blob.take(2) / blob.drop(2))
    val shop = ProjectRepo.locate(gitTemp, "acme-shop").get
    assert(shop.existsAt("acme-shop-v1.0.0"))
    val err = intercept[Exception](shop.exportTo("acme-shop-v1.0.0", dest))
    assert(err.getMessage.startsWith("git archive of acme-shop at acme-shop-v1.0.0 failed"), err.getMessage)
    assertEquals(os.read(dest / "keep.txt"), "kept")
    assertEquals(os.list(gitTemp).map(_.last).filter(_.startsWith(".")), Seq.empty)

  test("existsAt - the project's folder in one repo, the root of an own clone"):
    val gitTemp = singleRepoGitTemp()
    val shop    = ProjectRepo.locate(gitTemp, "acme-shop").get
    assert(shop.existsAt("acme-shop-v1.0.0"))
    assert(!ProjectRepo.locate(gitTemp, "acme-new").get.existsAt("acme-shop-v1.0.0"))
    val own = os.temp.dir(prefix = "git-temp")
    os.write(own / "acme-own" / "README.md", "own", createFolders = true)
    git(own / "acme-own", "init", "-q")
    git(own / "acme-own", "add", ".")
    git(own / "acme-own", "commit", "-q", "-m", "first")
    git(own / "acme-own", "tag", "v1.0.0")
    val ownRepo = ProjectRepo.locate(own, "acme-own").get
    assert(ownRepo.existsAt("v1.0.0"))
    assert(!ownRepo.existsAt("v9.9.9"))
    ownRepo.exportTo("v1.0.0", own / "export" / "acme-own")
    assertEquals(os.read(own / "export" / "acme-own" / "README.md"), "own")

  test("locate - in several clones: the first by name, with a warning"):
    val gitTemp = singleRepoGitTemp()
    val copy    = gitTemp / "orchescala-acme-copy"
    os.copy(gitTemp / "orchescala-acme", copy)
    val out = java.io.ByteArrayOutputStream()
    val shop = Console.withOut(out)(ProjectRepo.locate(gitTemp, "acme-shop")).get
    assertEquals(shop.repo, gitTemp / "orchescala-acme")
    assert(out.toString.contains("several clones"), out.toString)

  test("resolveTag - origin not reachable: the local tags still count, the failure is logged"):
    val gitTemp = singleRepoGitTemp()
    git(gitTemp / "orchescala-acme", "remote", "add", "origin", (gitTemp / "gone.git").toString)
    val shop    = ProjectRepo.locate(gitTemp, "acme-shop").get
    val out     = java.io.ByteArrayOutputStream()
    Console.withOut(out):
      assertEquals(shop.resolveTag("1.0.0"), Some("acme-shop-v1.0.0")) // local: no fetch
      assertEquals(out.toString, "")
      assertEquals(shop.resolveTag("3.0.0"), None) // not local: fetched - and that failed
    assert(out.toString.contains(s"fetching the tags of ${shop.repo} failed"), out.toString)

  test("fetchTagsOnce - once per repo within FetchValidMs, a failed fetch only FailedFetchValidMs"):
    val repo = singleRepoGitTemp() / "orchescala-acme"
    Console.withOut(java.io.ByteArrayOutputStream()):
      assert(ProjectRepo.fetchTagsOnce(repo, now = 1000)) // no remote: git fetch succeeds
      assert(!ProjectRepo.fetchTagsOnce(repo, now = 1000 + ProjectRepo.FetchValidMs - 1))
      assert(ProjectRepo.fetchTagsOnce(repo, now = 1000 + ProjectRepo.FetchValidMs))
      val gone = singleRepoGitTemp() / "orchescala-acme"
      git(gone, "remote", "add", "origin", (gone / os.up / "gone.git").toString)
      assert(ProjectRepo.fetchTagsOnce(gone, now = 1000)) // fails
      assert(!ProjectRepo.fetchTagsOnce(gone, now = 1000 + ProjectRepo.FailedFetchValidMs - 1))
      assert(ProjectRepo.fetchTagsOnce(gone, now = 1000 + ProjectRepo.FailedFetchValidMs))

  test("fetchTagsOnce - the window counts from the end of a slow fetch"):
    val repo  = singleRepoGitTemp() / "orchescala-acme"
    var clock = 0L
    def slowFailingFetch(r: os.Path) =
      clock += 60000 // timed out after a minute
      false
    Console.withOut(java.io.ByteArrayOutputStream()):
      assert(ProjectRepo.fetchTagsOnce(repo, now = clock, fetch = slowFailingFetch))
      // the next project, right after: still within the failed window - not another minute
      assert(!ProjectRepo.fetchTagsOnce(repo, now = clock, fetch = slowFailingFetch))

  test("resolveTag - projects of one repo in parallel: the second waits for the fetch of the first"):
    val origin = singleRepoGitTemp() / "orchescala-acme"
    val gitTemp = os.temp.dir(prefix = "git-temp")
    os.proc("git", "clone", "-q", origin.toString, (gitTemp / "orchescala-acme").toString)
      .call(stdout = os.Pipe, stderr = os.Pipe)
    // released after the clone - only on origin
    git(origin, "tag", "acme-shop-v1.1.0")
    git(origin, "tag", "acme-cards-v1.1.0")
    import scala.concurrent.*, scala.concurrent.duration.*
    given ExecutionContext = pool // git blocks - not on the global pool
    val found = Await.result(
      Future.sequence(
        Seq("acme-shop", "acme-cards", "acme-shop", "acme-cards").map: p =>
          Future(blocking(ProjectRepo.locate(gitTemp, p).get.resolveTag("1.1.0"))) // git: blocking
      ),
      1.minute
    )
    assertEquals(found, Seq("acme-shop", "acme-cards", "acme-shop", "acme-cards").map(p => Some(s"$p-v1.1.0")))

  test("fetchTagsOnce - parallel callers of one repo: one fetch, the others wait for it"):
    val repo    = singleRepoGitTemp() / "orchescala-acme" // a fresh path: no fetch of it yet
    val fetches = java.util.concurrent.atomic.AtomicInteger()
    val done    = java.util.concurrent.atomic.AtomicBoolean()
    def slowFetch(r: os.Path) =
      fetches.incrementAndGet()
      Thread.sleep(300)
      done.set(true)
      true
    import scala.concurrent.*, scala.concurrent.duration.*
    given ExecutionContext = pool // git blocks - not on the global pool
    // each caller returns only after the fetch is done - fetched by itself or waited for
    val after = Await.result(
      Future.sequence((1 to 4).map(_ => Future(blocking { ProjectRepo.fetchTagsOnce(repo, fetch = slowFetch); done.get }))),
      1.minute
    )
    assertEquals(fetches.get, 1)
    assertEquals(after, IndexedSeq.fill(4)(true))

  test("resolveTag - in one repo a bare v<version> of another project is not this project's"):
    val gitTemp = singleRepoGitTemp()
    val repo    = gitTemp / "orchescala-acme"
    git(repo, "tag", "v2.0.0", "acme-shop-v1.0.0") // the commit before acme-new
    val newOne  = ProjectRepo.locate(gitTemp, "acme-new").get
    Console.withOut(java.io.ByteArrayOutputStream()):
      assertEquals(newOne.resolveTag("2.0.0"), None)
    assertEquals(SiteAssembler.releaseRef(newOne, "2.0.0"), None)
    // acme-cards never had a tag of its own: a plain tag still counts (released before tags per project)
    val cards   = ProjectRepo.locate(gitTemp, "acme-cards").get
    assertEquals(cards.resolveTag("2.0.0"), Some("v2.0.0"))
    assertEquals(SiteAssembler.releaseRef(cards, "2.0.0"), Some("v2.0.0"))
    // acme-shop tags its own releases (acme-shop-v1.0.0): a plain v2.0.0 is another project's
    val shop    = ProjectRepo.locate(gitTemp, "acme-shop").get
    Console.withOut(java.io.ByteArrayOutputStream()):
      assertEquals(shop.resolveTag("2.0.0"), None)
    assertEquals(SiteAssembler.releaseRef(shop, "2.0.0"), None)

  test("fetchTagsOnce - a release tag moved on origin: named, the local one stays"):
    val origin  = singleRepoGitTemp() / "orchescala-acme"
    val gitTemp = os.temp.dir(prefix = "git-temp")
    val clone   = gitTemp / "orchescala-acme"
    os.proc("git", "clone", "-q", origin.toString, clone.toString).call(stdout = os.Pipe, stderr = os.Pipe)
    git(origin, "tag", "-f", "acme-shop-v1.0.0", "HEAD") // re-tagged after a botched release
    val out = java.io.ByteArrayOutputStream()
    Console.withOut(out)(ProjectRepo.fetchTagsOnce(clone))
    assert(out.toString.contains("differ on origin"), out.toString)
    assert(out.toString.contains("acme-shop-v1.0.0"), out.toString)
    val local = os.proc("git", "-C", clone.toString, "rev-parse", "acme-shop-v1.0.0^{commit}").call().out.text().trim
    val first = os.proc("git", "-C", origin.toString, "rev-list", "--max-parents=0", "HEAD").call().out.text().trim
    assertEquals(local, first)

  test("exportRelease - a plain v<version> in one repo: for a project without tags of its own, with a warning"):
    val gitTemp = singleRepoGitTemp()
    git(gitTemp / "orchescala-acme", "tag", "v3.0.0") // the company's tag
    val out     = java.io.ByteArrayOutputStream()
    val tag     = Console.withOut(out)(ProjectRepo.exportRelease(gitTemp, "acme-cards", "3.0.0", gitTemp / "acme-cards"))
    assertEquals(tag, Some("v3.0.0"))
    assert(out.toString.contains("no tag of its own"), out.toString)
    // acme-shop has tags of its own - no acme-shop-v3.0.0: the run stops instead of taking v3.0.0
    Console.withOut(java.io.ByteArrayOutputStream()):
      intercept[Exception](ProjectRepo.exportRelease(gitTemp, "acme-shop", "3.0.0", gitTemp / "acme-shop"))
    val own     = java.io.ByteArrayOutputStream()
    Console.withOut(own)(ProjectRepo.exportRelease(gitTemp, "acme-shop", "1.0.0", gitTemp / "acme-shop"))
    assert(!own.toString.contains("no tag of its own"), own.toString)

  test("exportRelease - origin not reachable: the error says so, not «unreleased»"):
    val gitTemp = singleRepoGitTemp()
    git(gitTemp / "orchescala-acme", "remote", "add", "origin", (gitTemp / "gone.git").toString)
    val err = Console.withOut(java.io.ByteArrayOutputStream()):
      intercept[Exception](ProjectRepo.exportRelease(gitTemp, "acme-shop", "7.0.0", gitTemp / "acme-shop"))
    assert(err.getMessage.contains("not checked on origin"), err.getMessage)
    assert(err.isInstanceOf[ReleaseNotFound]) // no release - not a broken repo
    assert(!err.getMessage.contains("released?"), err.getMessage)

  test("exportTo - leftovers of a killed run next to dest are removed - only the project's own"):
    val gitTemp = singleRepoGitTemp()
    // the start is in the name - one older than an export may take, one of now (another run, at work)
    val old     = System.currentTimeMillis - ProjectRepo.ExportTimeoutMs - 60000
    val young   = System.currentTimeMillis
    os.makeDir.all(gitTemp / s".acme-shop.orch-export-$old-1")
    os.write(gitTemp / s".acme-shop.orch-export-$old-1.git-archive.err", "old")
    os.makeDir.all(gitTemp / s".acme-shop.orch-export-old-$old-2") // the aside of a swap, killed
    os.makeDir.all(gitTemp / s".acme-shop.orch-export-$young-3")
    os.makeDir.all(gitTemp / s".acme-shop-plus.orch-export-$old-4") // another project, whose name starts the same
    ProjectRepo.locate(gitTemp, "acme-shop").get.exportTo("acme-shop-v1.0.0", gitTemp / "acme-shop")
    assertEquals(
      os.list(gitTemp).map(_.last).filter(_.startsWith(".")).sorted,
      IndexedSeq(s".acme-shop-plus.orch-export-$old-4", s".acme-shop.orch-export-$young-3")
    )
    // and the other way round: acme's cleanup does not touch acme-shop's
    os.makeDir.all(gitTemp / s".acme-shop.orch-export-$old-5")
    ProjectRepo.locate(gitTemp, "acme-shop").get.exportTo("acme-shop-v1.0.0", gitTemp / "acme")
    assert(os.exists(gitTemp / s".acme-shop.orch-export-$old-5"))

  test("releaseTags - a project whose name starts another's (acme / acme-shop): acme-shop's tags are not acme's"):
    val gitTemp = singleRepoGitTemp()
    val repo    = gitTemp / "orchescala-acme"
    os.write(repo / "projects" / "acme" / "README.md", "acme", createFolders = true)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "acme")
    git(repo, "tag", "v5.0.0")
    val acme    = ProjectRepo.locate(gitTemp, "acme").get
    assert(!acme.isOwnTag("acme-shop-v1.0.0"))
    assert(!acme.isOwnTag("acme-2fa-v1.0.0")) // a project acme-2fa - its name starts with a digit
    assert(!acme.isOwnTag("acme-2-v1.0.0") && !acme.isOwnTag("acme-2-1.0.0")) // a project acme-2
    assert(acme.isOwnTag("acme-1.2.0") && acme.isOwnTag("acme-1.0-beta"))
    assert(!acme.isOwnTag("acme-1-v1.2.0")) // a project acme-1
    assert(acme.isOwnTag("acme-v2") && acme.isOwnTag("acme-v1-RC1")) // with a v: one number is a version
    assert(!acme.isOwnTag("acme-2")) // without one: a project acme-2
    assert(!acme.isOwnTag("acme-2fa-1.0.0"))
    assert(acme.isOwnTag("acme-v1.0.0-RC1") && acme.isOwnTag("acme-1.2.3+build.7"))
    assert(acme.isOwnTag("acme-v5.0.0") && acme.isOwnTag("acme-5.0.0"))
    // acme has no tag of its own (acme-shop-v1.0.0 is acme-shop's): the plain v5.0.0 counts
    assertEquals(acme.releaseTags("5.0.0", acme.localTags()), Seq("v5.0.0"))
    git(repo, "tag", "acme-v5.0.1")
    assertEquals(acme.releaseTags("5.0.0", acme.localTags()), Seq.empty) // now it has: no plain tags

  test("locate - the orchescala-<company> clone before a clone left from before"):
    val gitTemp = singleRepoGitTemp()
    os.copy(gitTemp / "orchescala-acme", gitTemp / "acme") // the old place initProject cloned to
    val shop = Console.withOut(java.io.ByteArrayOutputStream())(ProjectRepo.locate(gitTemp, "acme-shop")).get
    assertEquals(shop.repo, gitTemp / "orchescala-acme")

  test("exportFailure - the cause: tar first, git only with a message of its own"):
    def failure(gitDone: Boolean, gitExit: Int, gitErr: String, tarExit: Int, tarErr: String) =
      ProjectRepo.exportFailure("acme-shop at v1", gitDone, gitExit, gitErr, tarExit, tarErr)
    assertEquals(failure(true, 0, "", 0, ""), None)
    // git on its own (a missing object): git's message, tar's added
    assertEquals(failure(true, 128, "fatal: bad object", 2, "unexpected EOF"),
      Some("git archive of acme-shop at v1 failed: fatal: bad object (tar: unexpected EOF)"))
    // tar first (an unknown option): git died on the closed pipe without a word - tar is the cause
    assertEquals(failure(true, 141, "", 64, "tar: unknown option"), Some("tar of acme-shop at v1 failed: tar: unknown option"))
    // git stopped after the timeout, tar fine so far
    assertEquals(failure(false, 143, "", 0, ""), Some("git archive of acme-shop at v1 did not finish: "))

  test("replace - the new folder in, the old one gone; a failing move puts the old one back"):
    val dir   = os.temp.dir(prefix = "swap")
    val dest  = dir / "acme-shop"
    os.write(dest / "old.txt", "old", createFolders = true)
    os.write(dir / "fresh" / "new.txt", "new", createFolders = true)
    ProjectRepo.replace(dest, dir / "fresh", old = dir / ".old")
    assertEquals(os.list(dest).map(_.last), IndexedSeq("new.txt"))
    assert(!os.exists(dir / ".old"))
    // the new folder is not there (the move fails): dest as before
    intercept[Exception](ProjectRepo.replace(dest, dir / "gone", old = dir / ".old"))
    assertEquals(os.read(dest / "new.txt"), "new")
    assert(!os.exists(dir / ".old"))

  test("exportTo - a deeper project folder: as many leading folders stripped"):
    val gitTemp = singleRepoGitTemp()
    val deep    = ProjectRepo(gitTemp / "orchescala-acme", "projects/acme-shop/03-api/", "acme-shop")
    deep.exportTo("acme-shop-v1.0.0", gitTemp / "api")
    assertEquals(os.list(gitTemp / "api").map(_.last), IndexedSeq("OpenApi.yml"))

end ProjectRepoTest
