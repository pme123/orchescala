package orchescala.helper.dev.company.docs.site

import munit.FunSuite

/** A project in git-temp: its own clone, or a company's single repo with the projects under
  * `projects/` and tags per project (`<project>-v<version>`).
  */
class ProjectRepoTest extends FunSuite:

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
    intercept[IllegalArgumentException](newOne.exportTo("acme-shop-v1.0.0", gitTemp / "acme-new"))
    assert(os.exists(gitTemp / "acme-shop" / "keep.txt"))

  test("exportTo - never empties the clone itself"):
    val gitTemp = singleRepoGitTemp()
    val shop    = ProjectRepo.locate(gitTemp, "acme-shop").get
    intercept[IllegalArgumentException](shop.exportTo("acme-shop-v1.0.0", gitTemp))
    intercept[IllegalArgumentException](shop.exportTo("acme-shop-v1.0.0", shop.repo))
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
    assert(err.getMessage.startsWith("git archive acme-shop-v1.0.0 of acme-shop failed"), err.getMessage)
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

  test("fetchTagsOnce - once per repo within FetchValidMs, then again"):
    val repo = singleRepoGitTemp() / "orchescala-acme"
    Console.withOut(java.io.ByteArrayOutputStream()):
      assert(ProjectRepo.fetchTagsOnce(repo, now = 1000))
      assert(!ProjectRepo.fetchTagsOnce(repo, now = 1000 + ProjectRepo.FetchValidMs - 1))
      assert(ProjectRepo.fetchTagsOnce(repo, now = 1000 + ProjectRepo.FetchValidMs))

  test("exportTo - a deeper project folder: as many leading folders stripped"):
    val gitTemp = singleRepoGitTemp()
    val deep    = ProjectRepo(gitTemp / "orchescala-acme", "projects/acme-shop/03-api/", "acme-shop")
    deep.exportTo("acme-shop-v1.0.0", gitTemp / "api")
    assertEquals(os.list(gitTemp / "api").map(_.last), IndexedSeq("OpenApi.yml"))

end ProjectRepoTest
