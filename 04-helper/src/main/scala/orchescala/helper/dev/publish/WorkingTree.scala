package orchescala.helper.dev.publish

import orchescala.helper.util.Helpers

/** The working tree of a release: clean before it (a release commits every change), restored
  * after a failed one - so the next try with the same version starts clean.
  */
object WorkingTree extends Helpers:

  /** A release commits all changes (`git commit -a`): its own (versions, generated docs) - and any
    * other change of the working tree, e.g. unfinished work. So it must be clean before - only the
    * CHANGELOG may be edited (untracked files are not committed).
    */
  def verifyCleanWorkingTree(repo: os.Path = workDir): Unit =
    val changed = changedTrackedFiles(repo)
    if changed.nonEmpty then
      throw IllegalStateException(
        s"Uncommitted changes - commit or stash them before a release:\n - ${changed.mkString("\n - ")}"
      )
  end verifyCleanWorkingTree

  /** The tracked files that differ from HEAD (staged or not) - without the CHANGELOG, the one
    * file a release edits. NUL-separated, so a path with spaces or special characters comes
    * as it is (`--porcelain` quotes them); no rename detection, so a path is always a path.
    * `filter`: git's `--diff-filter`, e.g. `A` for the files added to the index only.
    */
  private def changedTrackedFiles(repo: os.Path, filter: Option[String] = None): Seq[String] =
    os.proc(
      "git", "diff", "--name-only", "-z", "--no-renames", filter.map(f => s"--diff-filter=$f"), "HEAD"
    ).call(cwd = repo)
      .out.text().split('\u0000').toSeq
      .filter(_.nonEmpty)
      .filterNot(_ == "CHANGELOG.md")

  /** A failed release leaves its changes in the tracked files (the versions, generated docs) -
    * the next try with the same version stopped at [[verifyCleanWorkingTree]]. So they are
    * restored from HEAD (the index too); a file added to the index only (not in HEAD) is
    * unstaged and stays as untracked; the CHANGELOG and untracked files stay as they are.
    */
  def restoreWorkingTree(repo: os.Path = workDir): Unit =
    val changed = changedTrackedFiles(repo)
    if changed.nonEmpty then
      println(s"Restoring the working tree for the next try:\n - ${changed.mkString("\n - ")}")
      val added  = changedTrackedFiles(repo, filter = Some("A"))
      val inHead = changed.diff(added)
      if added.nonEmpty then
        os.proc("git" +: "rm" +: "--quiet" +: "--force" +: "--cached" +: "--" +: added).call(cwd = repo)
      if inHead.nonEmpty then
        os.proc("git" +: "checkout" +: "HEAD" +: "--" +: inHead).call(cwd = repo)
  end restoreWorkingTree

  /** `body` with the restore of a failed release - for the changes made before the
    * [[ReleaseRun]] (the versions). A fatal error goes through without a restore.
    */
  def restoring[T](restore: RestoreForRetry)(body: => T): T =
    try body
    catch
      case scala.util.control.NonFatal(e) =>
        suppressedBy(e)(restore.now())
        throw e

  /** [[restoreWorkingTree]] when a release fails before its git step - after it, the version is
    * uploaded and committed, nothing to retry. A snapshot keeps its changes as before.
    *
    * The restore discards changes - so it is armed only when the tree is clean NOW (as
    * [[verifyCleanWorkingTree]] guarantees for a release): with changes of yours in the tree,
    * nothing is restored, whatever the caller checked.
    */
  def restoreForRetry(
      isSnapshot: Boolean,
      repo: os.Path = workDir,
      restore: os.Path => Unit = restoreWorkingTree(_)
  ): RestoreForRetry = RestoreForRetry(isSnapshot, repo, restore)

  /** The restore of one release - armed with the changes of the tree at its creation. Once
    * only: on Ctrl-C the failing sbt run AND the shutdown hook ask for it - the second waits
    * for the first (the JVM ends with the hook) and finds it done. Fails the restore, it is
    * not done - the next caller tries again.
    */
  final class RestoreForRetry(isSnapshot: Boolean, repo: os.Path, restore: os.Path => Unit)
      extends (ReleaseStep => Unit):
    private val changesBefore = if isSnapshot then Seq.empty else changedTrackedFiles(repo)
    private var done          = false

    /** The step failed - after the git step the version is uploaded and committed, nothing to retry. */
    def apply(step: ReleaseStep): Unit =
      if step != ReleaseStep.Git then now()

    /** Something before the release failed (the versions). */
    def now(): Unit =
      if !isSnapshot then
        synchronized:
          if done then ()
          else if changesBefore.nonEmpty then
            println(
              s"Not restoring the working tree - it had changes before the release:\n - ${changesBefore.mkString("\n - ")}"
            )
          else
            restore(repo)
            done = true
  end RestoreForRetry

end WorkingTree
