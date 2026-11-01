package orchescala.helper.dev.update.merge

import scala.collection.mutable

/** The merge of a BPMN or DMN in two parts - the logic (process, tasks, mappings, tables) as text
  * like `git merge`, the diagram (`bpmndi:` / `dmndi:` - shapes and edges with their coordinates)
  * entry by entry:
  *   - an entry only one side changed (moved, added, removed) gets that change,
  *   - an entry both moved: the code's layout stays (a note, no conflict - it is only layout),
  *   - an entry whose element is no longer in the merged logic goes,
  *   - new entries go after their neighbour in the new diagram.
  *
  * So a moved shape never conflicts with a changed mapping, nor two moved shapes with each other.
  * Works line by line on the form of the Camunda Modeler (`modelerXml`): each shape or edge starts
  * on a line of its own. A document where the diagram cannot be read that way: `None` - then the
  * whole file is merged as text.
  */
object DiagramMerge:

  /** The merged text, its conflicts (in the logic) and what to tell about the layout. */
  case class Result(merge: ThreeWay.Result, notes: Seq[String])

  private case class Entry(key: String, ref: Option[String], lines: Seq[String])
  private case class Diagram(key: String, head: Seq[String], entries: Seq[Entry], tail: Seq[String])
  private case class Split(logic: Seq[String], diagrams: Seq[Diagram])

  /** in the place of the diagram while the logic is merged - the same on all three sides */
  private val marker = "<!-- orchescala: diagram -->"

  private val DiagramOpen  = """^\s*<(?:[\w.-]+:)?(?:BPMN|DMN)Diagram\b.*$""".r
  private val DiagramClose = """^\s*</(?:[\w.-]+:)?(?:BPMN|DMN)Diagram\s*>\s*$""".r
  private val EntryOpen    = """^\s*<((?:[\w.-]+:)?(?:BPMN|DMN)(?:Shape|Edge))\b.*$""".r
  private val Id           = """\sid="([^"]*)"""".r
  private val Ref          = """\s(?:bpmnElement|dmnElementRef)="([^"]*)"""".r

  def merge(base: String, code: String, spec: String): Option[Result] =
    for
      b <- split(base)
      c <- split(code)
      n <- split(spec)
    yield
      val logic    = ThreeWay.merge(text(b.logic), text(c.logic), text(n.logic))
      val notes    = Seq.newBuilder[String]
      // the elements of the merged logic - a shape of an element that is gone goes with it
      val elements = Option.when(logic.clean)(Id.findAllMatchIn(logic.text).map(_.group(1)).toSet)
      val diagrams = merged(b.diagrams, c.diagrams, n.diagrams)(_.key): (bd, cd, nd, picked, _) =>
        picked.map: d =>
          val entries = merged(bd.toSeq.flatMap(_.entries), cd.toSeq.flatMap(_.entries), nd.toSeq.flatMap(_.entries))(_.key):
            (_, ce, _, chosen, both) =>
              if both then
                notes += s"Layout of ${ce.flatMap(_.ref).orElse(ce.map(_.key)).getOrElse("?")}: moved in the code and in orch-spec - the code's stays"
              chosen
          .filter(e => e.ref.forall(r => elements.forall(_.contains(r))))
          val head    = pick(bd.map(_.head), cd.map(_.head), nd.map(_.head))._1.getOrElse(d.head)
          val tail    = pick(bd.map(_.tail), cd.map(_.tail), nd.map(_.tail))._1.getOrElse(d.tail)
          Diagram(d.key, head, entries, tail)
      val lines    = logic.text.linesIterator.toSeq
      val at       = lines.indexWhere(_.trim == marker)
      val diagram  = diagrams.flatMap(d => d.head ++ d.entries.flatMap(_.lines) ++ d.tail)
      val all      =
        if at < 0 then lines.patch(lines.lastIndexWhere(_.trim.nonEmpty), diagram, 0)
        else lines.patch(at, diagram, 1).filterNot(_.trim == marker)
      Result(ThreeWay.Result(text(all), logic.conflicts), notes.result())

  /** One side of the rule: what only one side changed comes; both changed - the code's (`both`). */
  private def pick[T](b: Option[T], c: Option[T], n: Option[T]): (Option[T], Boolean) =
    if c == n || b == n then c -> false
    else if b == c then n -> false
    else c -> true

  /** Merges keyed parts: per key `pick`, then `resolve` (the three, the picked one, whether both
    * changed) decides; in the order of the code, a new one after its neighbour in the new version.
    */
  private def merged[T](b: Seq[T], c: Seq[T], n: Seq[T])(key: T => String)(
      resolve: (Option[T], Option[T], Option[T], Option[T], Boolean) => Option[T]
  ): Seq[T] =
    val (bm, cm, nm) = (b.map(x => key(x) -> x).toMap, c.map(x => key(x) -> x).toMap, n.map(x => key(x) -> x).toMap)
    val order        = mutable.ArrayBuffer.from(c.map(key).distinct)
    // the new ones in the order of the code: after the one before them in the new version
    val newKeys      = n.map(key).distinct
    newKeys.zipWithIndex.filterNot((k, _) => order.contains(k)).foreach: (k, i) =>
      val before = newKeys.take(i).reverse.find(order.contains)
      order.insert(before.fold(0)(order.indexOf(_) + 1), k)
    order.toSeq.flatMap: k =>
      val (chosen, both) = pick(bm.get(k), cm.get(k), nm.get(k))
      resolve(bm.get(k), cm.get(k), nm.get(k), chosen, both)
  end merged

  private def text(lines: Seq[String]): String = lines.mkString("", "\n", "\n")

  /** The logic with the marker where the diagrams were, and the diagrams - None if there are none
    * or they cannot be read line by line.
    */
  private def split(xml: String): Option[Split] =
    val lines = xml.linesIterator.map(_.stripTrailing).toVector
    val first = lines.indexWhere(DiagramOpen.matches)
    val last  = lines.lastIndexWhere(DiagramClose.matches)
    if first < 0 || last < first then None
    else
      val indent = lines(first).takeWhile(_ == ' ')
      diagrams(lines.slice(first, last + 1)).map: ds =>
        Split(lines.take(first) ++ Seq(indent + marker) ++ lines.drop(last + 1), ds)

  private def diagrams(lines: Seq[String]): Option[Seq[Diagram]] =
    val out = Seq.newBuilder[Diagram]
    var i   = 0
    var ok  = true
    while ok && i < lines.size do
      if lines(i).trim.isEmpty then i += 1
      else if DiagramOpen.matches(lines(i)) then
        val end = lines.indexWhere(DiagramClose.matches, i)
        if end < 0 then ok = false
        else
          diagram(lines.slice(i, end + 1)) match
            case Some(d) => out += d
            case None    => ok = false
          i = end + 1
      else ok = false
    Option.when(ok)(out.result())
  end diagrams

  // the lines before the first entry, the entries, the lines after the last
  private def diagram(lines: Seq[String]): Option[Diagram] =
    val key     = Id.findFirstMatchIn(lines.head).map(_.group(1)).getOrElse("")
    val entries = Seq.newBuilder[Entry]
    val head    = Seq.newBuilder[String]
    val tail    = Seq.newBuilder[String]
    var seen    = false
    var i       = 0
    var ok      = true
    while ok && i < lines.size do
      lines(i) match
        case EntryOpen(tag) =>
          val end =
            if lines(i).trim.endsWith("/>") then i
            else lines.indexWhere(_.trim.startsWith(s"</$tag"), i + 1)
          if end < 0 then ok = false
          else
            val block = lines.slice(i, end + 1)
            val ref   = Ref.findFirstMatchIn(lines(i)).map(_.group(1))
            Id.findFirstMatchIn(lines(i)).map(_.group(1)).orElse(ref) match
              case Some(k) => entries += Entry(k, ref, block)
              case None    => ok = false
            seen = true
            i = end + 1
        case line           =>
          // a line between the entries belongs to what comes after them
          if seen then tail += line else head += line
          i += 1
    end while
    Option.when(ok)(Diagram(key, head.result(), entries.result(), tail.result()))
  end diagram

end DiagramMerge
