package orchescala.helper.dev.update.merge

import org.eclipse.jgit.diff.{DiffAlgorithm, RawText, RawTextComparator}
import org.eclipse.jgit.merge.{MergeAlgorithm, MergeChunk, MergeFormatter}

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets.UTF_8
import scala.jdk.CollectionConverters.*

/** The 3-way merge of a text file - JGit's `MergeAlgorithm` (histogram diff) and
  * `MergeFormatter`, as `git merge` does it: `ours` is the code, `theirs` the new export.
  */
object ThreeWay:

  /** The result: the merged text - with conflict markers like `git merge` if there are
    * conflicts - and the conflicts (line in the code, the code's and the spec's lines).
    */
  case class Result(text: String, conflicts: Seq[Conflict]):
    def clean: Boolean = conflicts.isEmpty

  /** The names in the conflict markers: `<<<<<<< code` … `>>>>>>> orch-spec`. */
  val labels: Seq[String] = Seq("base", "code", "orch-spec")

  def merge(base: String, code: String, spec: String): Result =
    val algorithm = MergeAlgorithm(DiffAlgorithm.getAlgorithm(DiffAlgorithm.SupportedAlgorithm.HISTOGRAM))
    val texts     = Seq(base, code, spec).map(t => RawText(t.getBytes(UTF_8)))
    val result    = algorithm.merge(RawTextComparator.DEFAULT, texts(0), texts(1), texts(2))
    val out       = ByteArrayOutputStream()
    MergeFormatter().formatMerge(out, result, labels.asJava, UTF_8)
    val chunks    = result.iterator().asScala.toSeq
    // a conflict is a range of the code (FIRST) followed by the range of the spec (NEXT)
    val conflicts = chunks.zipWithIndex.collect:
      case (c, i) if c.getConflictState == MergeChunk.ConflictState.FIRST_CONFLICTING_RANGE =>
        val spec = chunks.drop(i + 1).find(_.getConflictState == MergeChunk.ConflictState.NEXT_CONFLICTING_RANGE)
        Conflict(
          line = c.getBegin + 1,
          spec = spec.map(s => lines(texts(s.getSequenceIndex), s.getBegin, s.getEnd)).getOrElse(""),
          code = lines(texts(c.getSequenceIndex), c.getBegin, c.getEnd)
        )
    Result(String(out.toByteArray, UTF_8), conflicts)
  end merge

  private def lines(text: RawText, begin: Int, end: Int): String =
    if begin >= end then "" else text.getString(begin, end, false).stripSuffix("\n")

end ThreeWay
