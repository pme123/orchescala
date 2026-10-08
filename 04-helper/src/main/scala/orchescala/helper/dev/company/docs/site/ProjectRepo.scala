package orchescala.helper.dev.company.docs.site

/** Where the git history of a project lies in git-temp - its own clone (`<git-temp>/<project>/.git`),
  * or, when all projects of a company live in one repo (`ProjectsPerGitRepoConfig.singleRepo`), that
  * clone with the project under `projects/<project>/`. In one repo the tags carry the project's name
  * (`<project>-v<version>`), as the projects are released one by one; a plain `v<version>` is taken
  * too.
  *
  * Needs `git` and `tar` on the PATH (tar with `--strip-components` and `--no-same-owner`: GNU tar,
  * bsdtar - also the one of Windows 10+).
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

  /** Is it the project's own tag (`<project>-v<version>`) - not a plain `v<version>`, which in one
    * repo may be any project's release (the folder of every project is there at nearly every tag).
    */
  def isOwnTag(tag: String): Boolean = !singleRepo || tag.startsWith(s"$project-")

  /** A warning when a release is taken from a plain tag in one repo - None for the project's own. */
  def plainTagWarning(tag: String): Option[String] =
    Option.when(!isOwnTag(tag))(
      s"  ! $project: no tag of its own ($project-v…) - using the plain '$tag', " +
        "which may be another project's release"
    )

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
    // left by a run that was killed midway - only this project's: `.acme.orch-export-…` is no prefix of
    // `.acme-shop.orch-export-…`, which another export may be writing right now
    val marker = s".${dest.last}.orch-export-"
    os.list(dest / os.up).filter(_.last.startsWith(marker)).foreach(os.remove.all)
    val fresh  = os.temp.dir(dir = dest / os.up, prefix = marker)
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
      // swap: the old one aside, the new one in - if that fails, the old one back (a locked file, a full
      // disk): dest is never gone
      val old = dest / os.up / s"${marker}old-${fresh.last.stripPrefix(marker)}"
      if os.exists(dest) then os.move(dest, old)
      try os.move(fresh, dest)
      catch
        case e: Throwable =>
          if os.exists(old) && !os.exists(dest) then os.move(old, dest)
          throw e
      os.remove.all(old)
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
  private final class FetchState:
    var validUntil: Long              = Long.MinValue
    /** why the last fetch failed - for the error of a tag that is then not found */
    var failure: Option[String]       = None
  private val fetches = java.util.concurrent.ConcurrentHashMap[os.Path, FetchState]()

  /** `git fetch --tags` in a clone, unless a recent fetch counts; no credential prompt (it would hang
    * the helper), no `--prune` (it would drop tags made in this clone only), a minute at most; a
    * failure is logged.
    * @param fetch the fetch itself - true if it worked (replaceable for tests)
    * @return true if it fetched now (false: a recent fetch counts)
    * @note blocks - for up to the fetch's timeout, also while waiting for another caller's fetch.
    *   Call it from a blocking thread (`ZIO.attemptBlocking`, as DocCreator does), never from ZIO's
    *   compute pool.
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
        // from its end: a fetch that timed out (60 s) is not already over its 30 s when it returns
        state.validUntil = now + (if ok then FetchValidMs else FailedFetchValidMs)
        state.failure = Option.when(!ok)(s"fetching the tags of $repo failed (see above)")
        true

  /** Why the last fetch of the repo failed - None if it worked or did not run. */
  private[site] def fetchFailure(repo: os.Path): Option[String] =
    Option(fetches.get(repo)).flatMap(s => s.synchronized(s.failure))

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
      // a release tag moved on origin: git keeps the local one - say which, the docs are of that commit
      val moved = why.linesIterator.filter(_.contains("would clobber existing tag")).toSeq
      if moved.nonEmpty then
        println(s"  ! tags of $repo differ on origin - the local ones are used:\n    ${moved.mkString("\n    ")}")
      else println(s"  ! fetching the tags of $repo failed: $why")
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
        // not «unreleased», if origin could not be asked - say so
        val why   = fetchFailure(repo.repo).fold(s"is $project $version released?")(f => s"$f - not checked on origin")
        throw new Exception(s"Tag not found in ${repo.repo}: $tried - $why")
      repo.plainTagWarning(tag).foreach(println)
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
