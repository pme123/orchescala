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

  /** The tag of a release of `version` - local first, then after fetching the tags from origin (once
    * per repo and run: several unreleased projects of one repo do not fetch it again and again).
    */
  def resolveTag(version: String): Option[String] =
    val candidates = tagCandidates(version)
    candidates.find(tags().contains).orElse:
      ProjectRepo.fetchTagsOnce(repo)
      val known = tags()
      candidates.find(known.contains)

  /** Is the project there at `ref`? In one repo a release tag of another project may lack it.
    * (`<ref>:` is the root tree of an own clone - `<ref>:.` is no object name.)
    */
  def existsAt(ref: String): Boolean =
    os.proc("git", "-C", repo.toString, "cat-file", "-e", s"$ref:${prefix.stripSuffix("/")}")
      .call(check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode == 0

  /** The project's files at `ref` into `dest` (emptied first) - in one repo only its own folder.
    * The archive is streamed into tar; `dest` must not be (or hold) the clone itself.
    */
  def exportTo(ref: String, dest: os.Path): Unit =
    require(!repo.startsWith(dest), s"$dest holds the clone $repo - not emptied")
    require(existsAt(ref), s"$project is not in $repo at $ref")
    // into a folder next to dest - dest is replaced only when everything is there
    val fresh  = os.temp.dir(dir = { os.makeDir.all(dest / os.up); dest / os.up }, prefix = s".${dest.last}-")
    val errors = fresh / os.up / s"${fresh.last}.git-archive.err" // a file: a noisy stderr does not block git
    try
      val archive = os.proc("git", "-C", repo.toString, "archive", "--format=tar", ref, if singleRepo then prefix.stripSuffix("/") else ".")
        .spawn(stderr = errors)
      val tar = os.proc("tar", "-x", "--no-same-owner", "-f", "-", "-C", fresh.toString, s"--strip-components=${prefix.count(_ == '/')}")
        .call(stdin = archive.stdout, check = false, stderr = os.Pipe)
      archive.waitFor()
      // git's failure is the cause - tar then only sees a cut stream
      if archive.exitCode() != 0 then
        throw new Exception(s"git archive $ref of $project failed: ${os.read(errors).trim}")
      if tar.exitCode != 0 then throw new Exception(s"tar of $project at $ref failed: ${tar.err.text().trim}")
      os.remove.all(dest)
      os.move(fresh, dest)
    finally
      os.remove.all(fresh)
      os.remove(errors, checkExists = false)

  private def tags(): Set[String] =
    os.proc("git", "-C", repo.toString, "tag", "-l").call(stdout = os.Pipe, check = false)
      .out.text().linesIterator.map(_.trim).toSet
end ProjectRepo

object ProjectRepo:

  private val fetched = java.util.concurrent.ConcurrentHashMap.newKeySet[os.Path]()

  /** `git fetch --tags` in a clone - once per run; no credential prompt (it would hang the helper), no
    * `--prune` (it would drop tags made in this clone only), a minute at most; a failure is logged.
    */
  private[site] def fetchTagsOnce(repo: os.Path): Unit =
    if fetched.add(repo) then
      val fetch = scala.util.Try(
        os.proc("git", "-C", repo.toString, "fetch", "--tags")
          .call(check = false, stdout = os.Pipe, stderr = os.Pipe, env = Map("GIT_TERMINAL_PROMPT" -> "0"), timeout = 60000)
      )
      fetch.toOption.filter(_.exitCode == 0) match
        case Some(_) => ()
        case None    =>
          val why = fetch.fold(_.getMessage, _.err.text().trim)
          println(s"  ! fetching the tags of $repo failed: $why")

  /** A release of a project in a company's single repo into `dest` (its copy in git-temp): the
    * project's folder at its tag. None if the project has its own clone (then it is checked out there).
    * @throws Exception if there is no tag for `version` or the project is not there at the tag
    */
  def exportRelease(gitTemp: os.Path, project: String, version: String, dest: os.Path): Option[String] =
    locate(gitTemp, project).filter(_.singleRepo).map: repo =>
      val tag = repo.resolveTag(version).getOrElse(
        throw new Exception(s"Tag not found in ${repo.repo}: ${repo.tagCandidates(version).mkString(" or ")}")
      )
      repo.exportTo(tag, dest)
      tag

  /** The repo of a project in git-temp: its own clone, else a clone that has it under `projects/`
    * (the first by name - with a warning if there are several).
    */
  def locate(gitTemp: os.Path, project: String): Option[ProjectRepo] =
    if os.exists(gitTemp / project / ".git") then Some(ProjectRepo(gitTemp / project, "", project))
    else if !os.isDir(gitTemp) then None
    else
      val clones = os.list(gitTemp).sortBy(_.last)
        .filter(d => os.exists(d / ".git") && os.isDir(d / "projects" / project))
      if clones.size > 1 then
        println(s"  ! $project is in several clones of $gitTemp (${clones.map(_.last).mkString(", ")}) - taking ${clones.head.last}")
      clones.headOption.map(ProjectRepo(_, s"projects/$project/", project))
end ProjectRepo
