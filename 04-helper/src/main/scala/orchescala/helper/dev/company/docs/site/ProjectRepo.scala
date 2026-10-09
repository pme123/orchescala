package orchescala.helper.dev.company.docs.site

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.{AtomicBoolean, AtomicReference}
import java.util.concurrent.locks.ReentrantLock
import scala.util.Try
import scala.util.control.NonFatal

/** Where the git history of a project lies in git-temp - its own clone (`<git-temp>/<project>/.git`),
  * or, when all projects of a company live in one repo (`ProjectsPerGitRepoConfig.singleRepo`), that
  * clone with the project under `projects/<project>/`. In one repo the tags carry the project's name
  * (`<project>-v<version>`), as the projects are released one by one; a plain `v<version>` is taken
  * too.
  *
  * One helper run per git-temp at a time: the locks are of this JVM - a second process on the same
  * git-temp could meet an export midway.
  *
  * Needs `git` and `tar` on the PATH - tar with `--strip-components` and `--no-same-owner` (GNU tar or
  * bsdtar; tested on Linux and macOS). exportTo says so if tar is missing.
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
  def isOwnTag(tag: String): Boolean = !singleRepo || OwnTag.matches(tag)

  /** `<project>-v2`, `<project>-v1.2.3` or `<project>-1.2.3`, also `-RC1` / `+build.7` - with a `v` any
    * version, without one a dotted version: not the tag of a project `<project>-shop`, `<project>-2fa` or
    * `<project>-2` (`<project>-2-v1.0.0`).
    */
  private lazy val OwnTag =
    (java.util.regex.Pattern.quote(project) + "-(v\\d+(\\.\\d+)*|\\d+(\\.\\d+)+)([-+](?!v?\\d)[0-9A-Za-z.+-]*)?").r

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

  /** The tags of `version` that count, of the `known` ones, in order. In one repo a plain `v<version>`
    * counts for a project without tags of its own, or when it is older than one of them (released before
    * tags per project); else it is some other project's release. And only a tag at which the project is
    * there.
    */
  def releaseTags(version: String, known: Set[String]): Seq[String] =
    val ownTags = if singleRepo then known.filter(isOwnTag) else Set.empty[String]
    // a plain tag from before the project's own ones (it is an ancestor of one of them) is its old release
    def plainCounts(t: String) = ownTags.isEmpty || ownTags.exists(own => strictAncestor(t, own))
    tagCandidates(version).filter(t => known.contains(t) && (isOwnTag(t) || plainCounts(t))).filter(existsAt)

  /** Is `a` an earlier commit of `b`'s history (not the same commit)? */
  private def strictAncestor(a: String, b: String): Boolean =
    def commit(r: String) = Try(os.proc("git", "-C", repo.toString, "rev-parse", s"$r^{commit}")
      .call(stdout = os.Pipe, stderr = os.Pipe).out.text().trim).toOption
    commit(a).zip(commit(b)).exists((ca, cb) =>
      ca != cb && os.proc("git", "-C", repo.toString, "merge-base", "--is-ancestor", ca, cb)
        .call(check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode == 0
    )

  /** The tag of a release of `version` - local first, then after fetching the tags from origin (once
    * per repo, see fetchTagsOnce). In one repo a tag of the candidates may be another project's
    * release (`v1.0.0`) - only a tag at which the project is there counts.
    *
    * Blocks (git, maybe a fetch of up to a minute) - for DocCreator's blocking threads, hence
    * `private[docs]`.
    *
    * A local tag is trusted: release tags are not moved. (`git fetch --tags` would not move a local one
    * anyway - it refuses to clobber an existing tag without `--force`.)
    */
  private[docs] def resolveTag(version: String): Option[String] =
    releaseTags(version, localTags()).headOption.orElse:
      ProjectRepo.fetchTagsOnce(repo)
      releaseTags(version, localTags()).headOption

  /** Is the project there at `ref`? In one repo a release tag of another project may lack it.
    * (`<ref>:` is the root tree of an own clone - `<ref>:.` is no object name.)
    */
  def existsAt(ref: String): Boolean =
    val tree = if singleRepo then folder else ""
    os.proc("git", "-C", repo.toString, "cat-file", "-e", s"$ref:$tree")
      .call(check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode == 0

  /** The end of git's stderr - a noisy one is not read whole into a message. */
  private def tail(file: os.Path): String =
    Try(os.read(file)).getOrElse("").trim.takeRight(4000)

  /** The project's files at `ref` into `dest` (emptied first) - in one repo only its own folder.
    * The archive is streamed into tar; `dest` must not be (or hold) the clone itself.
    */
  def exportTo(ref: String, dest: os.Path): Unit =
    // one export of a dest at a time - the BPMN and worker version of a project already run one after the
    // other (DocCreator.byProject), this makes it so for any caller
    val lock = ProjectRepo.exportLocks.computeIfAbsent(dest, _ => ReentrantLock())
    lock.lockInterruptibly()
    try exportLocked(ref, dest)
    finally lock.unlock()

  private def exportLocked(ref: String, dest: os.Path): Unit =
    val marker = s".${dest.last}.orch-export-"
    // a run that died between the two moves of a swap left dest away and the old one aside: back first,
    // whatever this export then does
    if os.isDir(dest / os.up) && !os.exists(dest) then
      os.list(dest / os.up).filter(_.last.startsWith(s"${marker}old-")).sortBy(_.last).lastOption
        .foreach(aside => Try(os.move(aside, dest)))
    // what the machine or the repo lacks - an error of the run, not of the code (require is for those)
    def fail(why: String) = throw new Exception(why)
    if !ProjectRepo.hasTar then
      fail("exporting a release needs a tar on the PATH with --no-same-owner and --strip-components " +
        "(GNU tar or bsdtar - Linux, macOS; not checked on Windows)")
    if repo.startsWith(dest) then fail(s"$dest holds the clone $repo - not emptied")
    if !existsAt(ref) then fail(s"$project is not in $repo at $ref")
    // into a folder next to dest - dest is replaced only when everything is there
    os.makeDir.all(dest / os.up)
    // left by a run that was killed midway - only this project's: `.acme.orch-export-…` is no prefix of
    // `.acme-shop.orch-export-…`, which another export may be writing right now (a plain startsWith - no
    // glob or regex, whatever the project's name)
    // older than an export may take - a younger one may be another run's, at work right now. The age is
    // the start in the name (a folder's mtime changes only with its own entries); with their
    // .git-archive.err; one another export removes meanwhile is no error
    val stale  = System.currentTimeMillis - ProjectRepo.ExportTimeoutMs
    os.list(dest / os.up).filter(_.last.startsWith(marker))
      .filter(p => ProjectRepo.startedAt(p.last.stripPrefix(marker)).forall(_ < stale))
      .foreach(p => Try(os.remove.all(p)))
    val fresh  = os.temp.dir(dir = dest / os.up, prefix = s"$marker${System.currentTimeMillis}-")
    // a file: a noisy stderr does not block git
    val errors = fresh / os.up / s"${fresh.last}.git-archive.err"
    try
      val git = os.proc("git", "-C", repo.toString, "archive", "--format=tar", ref, folder)
        .spawn(stderr = errors)
      try exportWith(git, ref, dest, fresh, errors, marker)
      finally if git.isAlive() then git.destroy()
    finally
      os.remove.all(fresh)
      os.remove(errors, checkExists = false)

  /** tar of `git`'s archive into `fresh`, then `fresh` in place of `dest`. */
  private def exportWith(
      git: os.SubProcess,
      ref: String,
      dest: os.Path,
      fresh: os.Path,
      errors: os.Path,
      marker: String
  ): Unit =
    val strip   = s"--strip-components=$depth"
    val tar     =
      try
        os.proc("tar", "-x", "--no-same-owner", "-f", "-", "-C", fresh, strip)
          .call(stdin = git.stdout, check = false, stderr = os.Pipe, timeout = ProjectRepo.ExportTimeoutMs)
      catch
        case NonFatal(e) =>
          // tar did not run or finish (the timeout): git stopped too, its message kept, the cause
          // attached - an interrupt is no NonFatal and goes on as it is
          git.destroy()
          throw new Exception(s"tar of $project at $ref failed: ${e.getMessage} (git: ${tail(errors)})", e)
    // tar gone early: git may block on the closed pipe - not for ever
    val gitDone = git.waitFor(ProjectRepo.ExportTimeoutMs)
    if !gitDone then git.destroy()
    val what    = s"$project at $ref"
    ProjectRepo.exportFailure(what, gitDone, git.exitCode(), tail(errors), tar.exitCode, tar.err.text().trim.takeRight(4000))
      .foreach(msg => throw new Exception(msg))
    ProjectRepo.replace(dest, fresh, old = dest / os.up / s"${marker}old-${fresh.last.stripPrefix(marker)}")

  private[site] def localTags(): Set[String] =
    os.proc("git", "-C", repo.toString, "tag", "-l").call(stdout = os.Pipe, check = false)
      .out.text().linesIterator.map(_.trim).toSet
end ProjectRepo

/** No release (tag) of a version - VERSIONS.conf names one that is not released, or origin could not be
  * asked. A broken repo or export is a plain Exception.
  */
final class ReleaseNotFound(message: String, cause: Throwable = null) extends Exception(message, cause)

object ProjectRepo:

  /** `dest` replaced by `fresh`: the old one aside, the new one in, the old one removed - if the move
    * fails (a locked file, a full disk), the old one goes back. Only a process that dies between the two
    * moves leaves dest away - the next export puts the old one back first.
    */
  private[site] def replace(dest: os.Path, fresh: os.Path, old: os.Path): Unit =
    if os.exists(dest) then os.move(dest, old)
    try os.move(fresh, dest)
    catch
      case NonFatal(e) =>
        // the original error counts - a failing way back is only added to it
        Try(if os.exists(old) && !os.exists(dest) then os.move(old, dest)).failed.foreach(e.addSuppressed)
        throw e
    // dest is the new one now - a leftover old one (a locked file) is no failure of the export; the next
    // export's cleanup takes it
    Try(os.remove.all(old)).failed.foreach(e => println(s"  ! $old not removed: ${e.getMessage}"))

  /** Why an export failed - None if it did not. Tar first: is it fine, a failing git is the cause; did it
    * fail, git counts only with a message of its own (a git that died on tar's closed pipe, or was
    * stopped, says nothing). No exit codes of signals - they differ by platform.
    */
  private[site] def exportFailure(
      what: String,
      gitDone: Boolean,
      gitExit: Int,
      gitErr: String,
      tarExit: Int,
      tarErr: String
  ): Option[String] =
    if gitDone && gitExit != 0 && (tarExit == 0 || gitErr.nonEmpty) then
      Some(s"git archive of $what failed: $gitErr" + (if tarExit != 0 then s" (tar: $tarErr)" else ""))
    else if tarExit != 0 then
      Some(s"tar of $what failed: $tarErr" + (if gitErr.nonEmpty then s" (git: $gitErr)" else ""))
    else if !gitDone || gitExit != 0 then Some(s"git archive of $what did not finish: $gitErr")
    else None

  /** A tar that takes what exportTo gives it - `--no-same-owner` and `--strip-components` (GNU tar,
    * bsdtar; not e.g. busybox's): tried on an empty archive.
    */
  private val tarChecked = AtomicBoolean(false)
  /** only a «yes» is kept - a check that failed by chance is tried again */
  private[docs] def hasTar: Boolean =
    tarChecked.get || { if checkTar() then tarChecked.set(true); tarChecked.get }
  private def checkTar(): Boolean =
    Try:
      val empty = os.proc("tar", "-c", "-f", "-", "-T", "/dev/null").call(stdout = os.Pipe, stderr = os.Pipe).out.bytes
      val into  = os.temp.dir(prefix = "tar-check")
      try
        os.proc("tar", "-x", "--no-same-owner", "--strip-components=0", "-f", "-", "-C", into)
          .call(stdin = empty, check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode == 0
      finally os.remove.all(into)
    .getOrElse(false)

  /** When an export folder was started - the millis in its name (`<millis>-…`, also `old-<millis>-…`). */
  private[site] def startedAt(rest: String): Option[Long] =
    rest.stripPrefix("old-").takeWhile(_.isDigit).toLongOption

  private[site] val exportLocks = ConcurrentHashMap[os.Path, ReentrantLock]()

  /** How long an export (git archive into tar) may take. */
  private[site] val ExportTimeoutMs = 10 * 60 * 1000L

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
  // a ReentrantLock, not synchronized: a fetch of up to a minute would pin a virtual thread's carrier
  /** What is known of a repo's last fetch - replaced as a whole, never changed. */
  private final case class Fetched(validUntil: Long = Long.MinValue, failure: Option[String] = None)
  private final class FetchState:
    val lock  = ReentrantLock()
    val state = AtomicReference(Fetched()) // also read without the lock (fetchFailure)
  private val fetches = ConcurrentHashMap[os.Path, FetchState]()

  /** `git fetch --tags` in a clone, unless a recent fetch counts; no credential prompt (it would hang
    * the helper), no `--prune` (it would drop tags made in this clone only), at most the fetch's timeout; a
    * failure is logged.
    * @param fetch the fetch itself - true if it worked (replaceable for tests)
    * @return true if it fetched now (false: a recent fetch counts)
    * @note blocks - for up to the fetch's timeout, also while waiting for another caller's fetch.
    *   Call it from a blocking thread (`ZIO.attemptBlocking`, as DocCreator does), never from ZIO's
    *   compute pool. A stalled origin makes the projects of a repo wait for its timeout once, then
    *   they fail fast for FailedFetchValidMs.
    */
  private[docs] def fetchTagsOnce(
      repo: os.Path,
      now: => Long = System.currentTimeMillis(),
      fetch: os.Path => Boolean = fetchTags(_)
  ): Boolean =
    val state = fetches.computeIfAbsent(repo, _ => FetchState())
    state.lock.lockInterruptibly()
    try
      val start = now
      if start < state.state.get.validUntil then false
      else
        val ok = fetch(repo)
        // from its end: a fetch that timed out (60 s) is not already over its 30 s when it returns
        state.state.set(Fetched(
          validUntil = now + (if ok then FetchValidMs else FailedFetchValidMs),
          failure = Option.when(!ok)(s"fetching the tags of $repo failed (see above)")
        ))
        true
    finally state.lock.unlock()

  /** Why the last fetch of the repo failed - None if it worked or did not run. */
  private[docs] def fetchFailure(repo: os.Path): Option[String] =
    Option(fetches.get(repo)).flatMap(_.state.get.failure) // no wait for a fetch that runs

  /** `git fetch --tags` (and `more`, e.g. `--all`) - no credential prompt, at most `timeoutMs`; a
    * failure is logged, a release tag moved on origin named. For the single repo and own clones alike.
    * @return true if it worked
    */
  private[docs] def fetchTags(repo: os.Path, more: Seq[String] = Nil, timeoutMs: Long = 60000): Boolean =
    val fetch = Try(
      os.proc("git", "-C", repo.toString, "fetch", "--tags", more)
        .call(
          check = false,
          stdout = os.Pipe,
          stderr = os.Pipe,
          // C: git's messages in English - the moved-tag case is recognised by them
          env = Map("GIT_TERMINAL_PROMPT" -> "0", "LC_ALL" -> "C"),
          timeout = timeoutMs
        )
    )
    val ok    = fetch.toOption.exists(_.exitCode == 0)
    if !ok then
      val why = fetch.fold(_.getMessage, _.err.text().trim)
      // a release tag moved on origin: git keeps the local one - say which, the docs are of that commit
      val moved = why.linesIterator.filter(_.contains("would clobber existing tag")).toSeq
      if moved.nonEmpty then
        val tags = moved.mkString("\n    ")
        println(s"  ! tags of $repo differ on origin - the local ones are used:\n    $tags")
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
  private[docs] def exportRelease(
      gitTemp: os.Path,
      project: String,
      version: String,
      dest: os.Path
  ): Option[String] =
    locate(gitTemp, project).filter(_.singleRepo).map: repo =>
      val tag = repo.resolveTag(version).getOrElse[String]:
        val tried = repo.tagCandidates(version).mkString(" or ")
        // not «unreleased», if origin could not be asked - say so
        val why   = fetchFailure(repo.repo).fold(s"is $project $version released?")(f => s"$f - not checked on origin")
        throw ReleaseNotFound(s"Tag not found in ${repo.repo}: $tried - $why")
      repo.plainTagWarning(tag).foreach(println)
      repo.exportTo(tag, dest)
      tag

  /** The repo of a project in git-temp: its own clone, else a clone that has it under `projects/` -
    * `orchescala-<company>` first (the clone ApiConfig makes), then by name; a warning if there are
    * several (e.g. one left from before).
    */
  def locate(gitTemp: os.Path, project: String): Option[ProjectRepo] =
    if os.exists(gitTemp / project / ".git") then Some(ProjectRepo(gitTemp / project, "", project))
    else if !os.isDir(gitTemp) then None
    else
      val clones = os.list(gitTemp).sortBy(d => (!d.last.startsWith("orchescala-"), d.last))
        .filter(d => os.exists(d / ".git") && os.isDir(d / "projects" / project))
      if clones.size > 1 then
        val names = clones.map(_.last).mkString(", ")
        println(s"  ! $project is in several clones of $gitTemp ($names) - taking ${clones.head.last}")
      clones.headOption.map(ProjectRepo(_, s"projects/$project/", project))
end ProjectRepo
