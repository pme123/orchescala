package orchescala.helper.dev.company.docs.site

/** git-temp for the tests: a company's single repo with the projects under `projects/` and tags per
  * project (`<project>-v<version>`). Tags and commits unsigned, whatever the developer's git says.
  */
object GitTempFixture:

  def git(dir: os.Path, args: String*): Unit =
    os.proc("git", "-c", "user.name=test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "tag.forcesignannotated=false", args)
      .call(cwd = dir, stdout = os.Pipe, stderr = os.Pipe)

  /** git-temp with a company repo: acme-shop released as 1.0.0, then changed; acme-cards never tagged. */
  def singleRepoGitTemp(): os.Path =
    val gitTemp = os.temp.dir(prefix = "git-temp")
    val repo    = gitTemp / "orchescala-acme"
    os.write(repo / "projects" / "acme-shop" / "03-api" / "OpenApi.yml", "version: 1.0.0\n", createFolders = true)
    os.write(repo / "projects" / "acme-shop" / "src" / "main" / "resources" / "camunda" / "shop.bpmn", "<bpmn/>", createFolders = true)
    os.write(repo / "projects" / "acme-cards" / "03-api" / "OpenApi.yml", "cards\n", createFolders = true)
    git(repo, "init", "-q")
    git(repo, "config", "gc.auto", "0") // objects stay loose - a test removes one
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "release")
    git(repo, "tag", "acme-shop-v1.0.0")
    os.write.over(repo / "projects" / "acme-shop" / "03-api" / "OpenApi.yml", "version: 1.1.0-SNAPSHOT\n")
    // a project that came after the release tag of acme-shop
    os.write(repo / "projects" / "acme-new" / "README.md", "new", createFolders = true)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "later")
    git(repo, "tag", "acme-new-v0.1.0")
    gitTemp

end GitTempFixture
