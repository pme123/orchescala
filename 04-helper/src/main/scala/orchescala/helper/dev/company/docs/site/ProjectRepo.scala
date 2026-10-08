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

  /** The project's folder in the repo (`projects/acme-shop`) - `.` for its own clone. */
  private def folder: String = if singleRepo then prefix.stripSuffix("/") else "."

  /** The leading folders `git archive` puts before the project's files. */
  private def depth: Int = if singleRepo then folder.split('/').count(_.nonEmpty) else 0

  /** The tags a release of `version` may have - the project's own first. */
  def tagCandidates(version: String): Seq[String] =
    if singleRepo then Seq(s"$project-v$version", s"$project-$version", s"v$version", version)
    else Seq(s"v$version", version)

  /** The tag of a release of `version` - local first, then after fetching the tags from origin (once
    * per repo, see fetchTagsOnce). In one repo a tag of the candidates may be another project's
    * release (`v1.0.0`) - only a tag at which the project is there counts.
    *
    * A local tag is trusted: release tags are not moved. (`git fetch --tags` would not move a local one
    * anyway - it refuses to clobber an existing tag without `--force`.)
    */
  def resolveTag(version: String): Option[String] =
    val candidates = tagCandidates(version)
    def found(known: Set[String]) = candidates.filter(known.contains).find(existsAt)
    found(tags()).orElse:
      ProjectRepo.fetchTagsOnce(repo)
      found(tags())

  /** Is the project there at `ref`? In one repo a release tag of another project may lack it.
    * (`<ref>:` is the root tree of an own clone - `<ref>:.` is no object name.)
    */
  def existsAt(ref: String): Boolean =
    val tree = if singleRepo then folder else ""
    os.proc("git", "-C", repo.toString, "cat-file", "-e", s"$ref:$tree")
      .call(check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode == 0

  /** The project's files at `ref` into `dest` (emptied first) - in one repo only its own folder.
    * The archive is streamed into tar; `dest` must not be (or hold) the clone itself.
    */
  def exportTo(ref: String, dest: os.Path): Unit =
    require(!repo.startsWith(dest), s"$dest holds the clone $repo - not emptied")
    require(existsAt(ref), s"$project is not in $repo at $ref")
    // into a folder next to dest - dest is replaced only when everything is there
    os.makeDir.all(dest / os.up)
    val fresh  = os.temp.dir(dir = dest / os.up, prefix = s".${dest.last}-")
    // a file: a noisy stderr does not block git
    val errors = fresh / os.up / s"${fresh.last}.git-archive.err"
    try
      val archive = os.proc("git", "-C", repo.toString, "archive", "--format=tar", ref, folder)
        .spawn(stderr = errors)
      val tar     = os.proc("tar", "-x", "--no-same-owner", "-f", "-", "-C", fresh, s"--strip-components=$depth")
        .call(stdin = archive.stdout, check = false, stderr = os.Pipe)
      archive.waitFor()
      // git's failure is the cause - tar then only sees a cut stream
      if archive.exitCode() != 0 then
        throw new Exception(s"git archive $ref of $project failed: ${os.read(errors).trim}")
      if tar.exitCode != 0 then
        throw new Exception(s"tar of $project at $ref failed: ${tar.err.text().trim}")
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

  /** A fetch per repo is good for this long - the projects of one docs run share it; a later run
    * fetches again. A failed fetch counts only FailedFetchValidMs: the other projects of the run do
    * not each wait for the same unreachable origin, a rerun soon after tries again.
    */
  private[site] val FetchValidMs       = 5 * 60 * 1000L
  private[site] val FailedFetchValidMs = 30 * 1000L

  /** Per repo: until when its last fetch counts. The lock serializes check and fetch - a project of
    * the same repo (DocCreator runs them in parallel, on blocking threads) waits for a running fetch,
    * at most its timeout, instead of reading the tags before it. One small entry per clone of git-temp,
    * for the run of the helper.
    */
  private case class FetchState(var validUntil: Long = Long.MinValue)
  private val fetches = java.util.concurrent.ConcurrentHashMap[os.Path, FetchState]()

  /** `git fetch --tags` in a clone, unless a recent fetch counts; no credential prompt (it would hang
    * the helper), no `--prune` (it would drop tags made in this clone only), a minute at most; a
    * failure is logged.
    * @param fetch the fetch itself - true if it worked (replaceable for tests)
    * @return true if it fetched now (false: a recent fetch counts)
    */
  private[site] def fetchTagsOnce(
      repo: os.Path,
      now: => Long = System.currentTimeMillis(),
      fetch: os.Path => Boolean = fetchTags
  ): Boolean =
    val state = fetches.computeIfAbsent(repo, _ => FetchState())
    state.synchronized:
      val start = now
      if start < state.validUntil then false
      else
        val ok = fetch(repo)
        state.validUntil = start + (if ok then FetchValidMs else FailedFetchValidMs)
        true

  private def fetchTags(repo: os.Path): Boolean =
    val fetch = scala.util.Try(
      os.proc("git", "-C", repo.toString, "fetch", "--tags")
        .call(
          check = false,
          stdout = os.Pipe,
          stderr = os.Pipe,
          env = Map("GIT_TERMINAL_PROMPT" -> "0"),
          timeout = 60000
        )
    )
    val ok    = fetch.toOption.exists(_.exitCode == 0)
    if !ok then
      val why = fetch.fold(_.getMessage, _.err.text().trim)
      println(s"  ! fetching the tags of $repo failed: $why")
    ok

  /** A release of a project in a company's single repo into `dest` (its copy in git-temp): the
    * project's folder at its tag. None if the project has its own clone (then it is checked out there).
    *
    * The release docs are of released versions only - like the checkout of an own clone
    * (DocCreator.resolveTagRef), a version without a tag stops the run; VERSIONS.conf names a version
    * that is not released yet. (The site's API page, SiteAssembler, shows HEAD instead, with a warning.)
    * @throws Exception if there is no tag for `version` or the project is not there at the tag
    */
  def exportRelease(
      gitTemp: os.Path,
      project: String,
      version: String,
      dest: os.Path
  ): Option[String] =
    locate(gitTemp, project).filter(_.singleRepo).map: repo =>
      val tag = repo.resolveTag(version).getOrElse:
        val tried = repo.tagCandidates(version).mkString(" or ")
        throw new Exception(s"Tag not found in ${repo.repo}: $tried - is $project $version released?")
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
        val names = clones.map(_.last).mkString(", ")
        println(s"  ! $project is in several clones of $gitTemp ($names) - taking ${clones.head.last}")
      clones.headOption.map(ProjectRepo(_, s"projects/$project/", project))
end ProjectRepo
