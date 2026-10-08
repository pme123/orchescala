package orchescala.helper.dev.company.docs.site

import munit.FunSuite

/** A project in git-temp: its own clone, or a company's single repo with the projects under
  * `projects/` and tags per project (`<project>-v<version>`).
  */
class ProjectRepoTest extends FunSuite:

  private def git(dir: os.Path, args: String*): Unit =
    os.proc("git", "-c", "user.name=test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "tag.forcesignannotated=false", args)
      .call(cwd = dir, stdout = os.Pipe, stderr = os.Pipe)

  /** git-temp with a company repo: acme-shop released as 1.0.0, then changed; acme-cards never tagged. */
  private def singleRepoGitTemp(): os.Path =
    val gitTemp = os.temp.dir(prefix = "git-temp")
    val repo    = gitTemp / "orchescala-acme"
    os.write(repo / "projects" / "acme-shop" / "03-api" / "OpenApi.yml", "version: 1.0.0\n", createFolders = true)
    os.write(repo / "projects" / "acme-shop" / "src" / "main" / "resources" / "camunda" / "shop.bpmn", "<bpmn/>", createFolders = true)
    os.write(repo / "projects" / "acme-cards" / "03-api" / "OpenApi.yml", "cards\n", createFolders = true)
    git(repo, "init", "-q")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "release")
    git(repo, "tag", "acme-shop-v1.0.0")
    os.write.over(repo / "projects" / "acme-shop" / "03-api" / "OpenApi.yml", "version: 1.1.0-SNAPSHOT\n")
    git(repo, "commit", "-q", "-am", "later")
    gitTemp

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

end ProjectRepoTest
