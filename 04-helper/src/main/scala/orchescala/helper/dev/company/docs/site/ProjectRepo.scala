package orchescala.helper.dev.company.docs.site

/** Where the git history of a project lies in git-temp - its own clone (`<git-temp>/<project>/.git`),
  * or, when all projects of a company live in one repo (`ProjectsPerGitRepoConfig.singleRepo`), that
  * clone with the project under `projects/<project>/`. In one repo the tags carry the project's name
  * (`<project>-v<version>`), as the projects are released one by one; a plain `v<version>` is taken
  * too.
  *
  * @param prefix the project's folder in the repo - empty for its own clone
  */
case class ProjectRepo(repo: os.Path, prefix: String, project: String):

  def singleRepo: Boolean = prefix.nonEmpty

  /** A file of the project, as a path in the repo. */
  def path(file: String): String = prefix + file

  /** The tags a release of `version` may have - the project's own first. */
  def tagCandidates(version: String): Seq[String] =
    if singleRepo then Seq(s"$project-v$version", s"$project-$version", s"v$version", version)
    else Seq(s"v$version", version)

  /** The tag of a release of `version` - local first, then after fetching the tags from origin. */
  def resolveTag(version: String): Option[String] =
    def known = os.proc("git", "-C", repo.toString, "tag", "-l").call(stdout = os.Pipe, check = false)
      .out.text().linesIterator.map(_.trim).toSet
    val candidates = tagCandidates(version)
    candidates.find(known.contains).orElse:
      os.proc("git", "-C", repo.toString, "fetch", "--tags", "--prune").call(check = false, stderr = os.Pipe)
      candidates.find(known.contains)

  /** The project's files at `ref` into `dest` (emptied first) - in one repo only its own folder. */
  def exportTo(ref: String, dest: os.Path): Unit =
    val tar = os.proc("git", "-C", repo.toString, "archive", "--format=tar", ref, if singleRepo then prefix.stripSuffix("/") else ".")
      .call(stdout = os.Pipe).out.bytes
    os.remove.all(dest)
    os.makeDir.all(dest)
    os.proc("tar", "-x", "-f", "-", "-C", dest.toString, s"--strip-components=${prefix.count(_ == '/')}")
      .call(stdin = tar)
end ProjectRepo

object ProjectRepo:

  /** The repo of a project in git-temp: its own clone, else a clone that has it under `projects/`. */
  def locate(gitTemp: os.Path, project: String): Option[ProjectRepo] =
    if os.exists(gitTemp / project / ".git") then Some(ProjectRepo(gitTemp / project, "", project))
    else if !os.isDir(gitTemp) then None
    else
      os.list(gitTemp).sortBy(_.last)
        .find(d => os.exists(d / ".git") && os.isDir(d / "projects" / project))
        .map(ProjectRepo(_, s"projects/$project/", project))
end ProjectRepo
