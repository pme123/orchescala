package orchescala.helper.dev.update.merge

import org.eclipse.jgit.diff.{DiffAlgorithm, Edit, RawText, RawTextComparator}
import org.eclipse.jgit.merge.{MergeAlgorithm, MergeChunk, MergeFormatter}

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets.UTF_8
import scala.jdk.CollectionConverters.*

/** The 3-way merge of a text file - JGit's `MergeAlgorithm` (histogram diff) and
  * `MergeFormatter`, as `git merge` does it: `ours` is the code, `theirs` the new export.
  *
  * With `ignoreForm` (code, not BPMN or DMN - they are formatted before) the form is no change:
  * lines that differ only in the amount of whitespace (the indentation of a formatter) are the
  * same - the code keeps its form. Imports the code has in another form (`import a.{X, Y}`,
  * `import a.*`) that give the spec all it imports are no change either.
  */
object ThreeWay:

  /** The result: the merged text - with conflict markers like `git merge` if there are
    * conflicts - and the conflicts (line in the code, the code's and the spec's lines).
    */
  case class Result(text: String, conflicts: Seq[Conflict]):
    def clean: Boolean = conflicts.isEmpty

  /** The names in the conflict markers: `<<<<<<< code` … `>>>>>>> orch-spec`. */
  val labels: Seq[String] = Seq("base", "code", "orch-spec")

  /** the amount of whitespace is no change - its presence is (`git diff -b`) */
  private val comparator = RawTextComparator.WS_IGNORE_CHANGE

  def merge(base: String, code: String, spec: String, ignoreForm: Boolean = false): Result =
    val algorithm = MergeAlgorithm(DiffAlgorithm.getAlgorithm(DiffAlgorithm.SupportedAlgorithm.HISTOGRAM))
    val theirs    = if ignoreForm then Imports.inFormOf(code, spec) else spec
    val texts     = Seq(base, code, theirs).map(t => RawText(t.getBytes(UTF_8)))
    val result    = algorithm.merge(if ignoreForm then comparator else RawTextComparator.DEFAULT, texts(0), texts(1), texts(2))
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

  /** A line of the diff between code and spec - as `git diff` shows it. */
  enum DiffLine:
    /** the same in both */
    case Same(line: String)
    /** only the form differs (indentation) - the spec's form */
    case Form(line: String)
    /** only in the code */
    case Code(line: String)
    /** only in the spec */
    case Spec(line: String)

  /** The lines of the code against those of the spec: what is the same, what only the form, what
    * only one of them has.
    */
  def diff(code: String, spec: String): Seq[DiffLine] =
    val (c, s) = (RawText(withNewline(code).getBytes(UTF_8)), RawText(withNewline(spec).getBytes(UTF_8)))
    val edits  = DiffAlgorithm.getAlgorithm(DiffAlgorithm.SupportedAlgorithm.HISTOGRAM).diff(comparator, c, s).asScala.toSeq
    val out    = Seq.newBuilder[DiffLine]
    // between the edits the lines are the same - but maybe not in their form
    def same(fromCode: Int, fromSpec: Int, n: Int) =
      (0 until n).foreach: k =>
        val (a, b) = (c.getString(fromCode + k), s.getString(fromSpec + k))
        out += (if a == b then DiffLine.Same(b) else DiffLine.Form(b))
    val (endC, endS) = edits.foldLeft((0, 0)):
      case ((ic, is), e: Edit) =>
        same(ic, is, e.getBeginA - ic)
        (e.getBeginA until e.getEndA).foreach(i => out += DiffLine.Code(c.getString(i)))
        (e.getBeginB until e.getEndB).foreach(i => out += DiffLine.Spec(s.getString(i)))
        (e.getEndA, e.getEndB)
    same(endC, endS, c.size - endC)
    out.result()
  end diff

  private def withNewline(text: String) = if text.isEmpty || text.endsWith("\n") then text else s"$text\n"

  private def lines(text: RawText, begin: Int, end: Int): String =
    if begin >= end then "" else text.getString(begin, end, false).stripSuffix("\n")

  /** The imports at the top of a Scala file - compared by what they import, not by their form. */
  private[merge] object Imports:

    private val Line     = """import\s+(.+)""".r
    private val Selector = """(.*)\.\{(.*)\}""".r

    /** The spec with the import block of the code - if the code imports all the spec imports. */
    def inFormOf(code: String, spec: String): String =
      (block(code), block(spec)) match
        case (Some(c), Some(s)) if c.lines != s.lines && s.names.forall(covered(c.names)) =>
          val lines = spec.split("\n", -1).toSeq
          (lines.take(s.from) ++ c.lines ++ lines.drop(s.until)).mkString("\n")
        case _ => spec

    private case class Block(from: Int, until: Int, lines: Seq[String], names: Seq[String])

    /** The first run of top-level imports (blank lines between them included) - None if there are none. */
    private def block(text: String): Option[Block] =
      val lines = text.split("\n", -1).toSeq
      val first = lines.indexWhere(isImport)
      Option.when(first >= 0):
        val run   = lines.drop(first).takeWhile(l => isImport(l) || l.trim.isEmpty)
        val until = first + run.lastIndexWhere(isImport) + 1
        val block = lines.slice(first, until)
        Block(first, until, block, block.filter(isImport).flatMap(names))

    private def isImport(line: String) = line.startsWith("import ")

    /** `import a.b.{X, Y}` → `a.b.X`, `a.b.Y` - `import a.b.*` → `a.b.*` */
    private def names(line: String): Seq[String] =
      line.trim match
        case Line(what) =>
          what.split(",(?![^{]*\\})").toSeq.map(_.trim).filter(_.nonEmpty).flatMap:
            case Selector(prefix, selectors) => selectors.split(",").toSeq.map(_.trim).filter(_.nonEmpty).map(n => s"$prefix.$n")
            case single                      => Seq(single)
        case _ => Seq.empty

    // a wildcard covers a plain name - not the givens (`a.given`), not a renamed one (`a.X as Y`),
    // not one it hides (`{X as _, *}`)
    private def covered(code: Seq[String])(name: String): Boolean =
      val prefix = name.lastIndexOf('.') match
        case -1 => ""
        case i  => name.take(i)
      val simple = name.drop(prefix.length + 1)
      val plain  = !simple.startsWith("given") && !simple.contains(" as ") && !simple.contains("=>")
      code.contains(name) ||
      plain && (code.contains(s"$prefix.*") || code.contains(s"$prefix._")) &&
      !code.exists(c => c.startsWith(s"$prefix.$simple ") && c.endsWith("_"))

  end Imports

end ThreeWay
