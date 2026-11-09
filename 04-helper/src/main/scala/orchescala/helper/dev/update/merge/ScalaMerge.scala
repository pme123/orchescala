package orchescala.helper.dev.update.merge

import orchescala.helper.dev.update.OrchSpecImports

/** The merge of a generated Scala file into the code - by structure, and the code is the basis.
  *
  * Both files are split by their indentation into their parts: classes, objects, the cases of an
  * enum and the members (`val`, `def`, `given`, `type`) - each with its doc comment and annotations.
  * Then, part by part:
  *
  * | the part                       | in the result                                                  |
  * |--------------------------------|----------------------------------------------------------------|
  * | the imports                    | those of the code, the ones of the spec it does not cover added |
  * | a class, object, enum in both  | the head (parameters, `extends`) of the spec, the body merged   |
  * | a member or case in both       | the spec's - the code's when the spec has a placeholder there   |
  * |                                | (`???`, a `TODO`): that is the developer's to implement         |
  * | only in the spec               | added - after the part it follows in the spec                   |
  * | a member only in the code      | stays - it is implementation                                    |
  * | a class, object, case or a     | stays - and is `removable`: the caller asks whether it goes     |
  * | declared field (`def x: T`, the |                                                                 |
  * | shared field of an enum) only  |                                                                 |
  * | in the code                    |                                                                 |
  *
  * What differs only in its form (indentation, line breaks) stays as the code has it.
  */
object ScalaMerge:

  /** @param text      the code with what the spec generates - what only the code has stays
    * @param removable the classes, objects and cases only the code has (`Out.Legacy`) - in `text`
    * @param without   `text` without them
    */
  case class Result(text: String, removable: Seq[String], without: String)

  def merge(code: String, spec: String): Result =
    val c    = code.split("\n", -1).toSeq
    val s    = spec.split("\n", -1).toSeq
    val keep = file(c, s, drop = false)
    val drop = file(c, s, drop = true)
    Result(keep._1.mkString("\n"), keep._2, drop._1.mkString("\n"))

  /** The classes and objects on the top level of a file - what goes when the file goes. */
  def topLevel(code: String): Seq[String] =
    val lines = code.split("\n", -1).toSeq
    parts(lines, 0, lines.size, 0).filter(_.kind != Kind.Member).map(_.name).distinct

  /** Equal but for blanks and line breaks. */
  def sameStructure(a: String, b: String): Boolean = compact(a) == compact(b)

  // ── the parts ───────────────────────────────────────────────────────────────────────────

  private enum Kind:
    case Type, Obj, Case, Member

  /** A part from `from` (its doc comment and annotations) to `until` (exclusive, its last code
    * line); `at` is the line that defines it.
    */
  private case class Part(kind: Kind, name: String, key: String, from: Int, at: Int, until: Int)

  private val mods       =
    """(?:(?:override|private|protected|final|implicit|lazy|sealed|abstract|inline|transparent|open|opaque|case)(?:\[[\w.]+\])?\s+)*"""
  private val TypeStart  = s"""$mods(?:class|trait|enum)\\s+(\\w+).*""".r
  private val ObjStart   = s"""$mods(?:object)\\s+(\\w+).*""".r
  private val CaseStart  = """case\s+(\w+(?:\s*,\s*\w+)*)\s*(?:\(.*|extends\b.*|:.*)?""".r
  private val ValStart   = s"""$mods(?:val|var|def)\\s+(\\w+).*""".r
  private val GivenStart = s"""$mods(?:given)\\s+(?:\\w+\\s*:\\s*)?(.+?)\\s*(?:=|\\bwith\\b).*""".r
  private val AliasStart = s"""$mods(?:type)\\s+(\\w+).*""".r
  private val Annotation = """@\w+(?:\([^()]*\))?\s+(.*)""".r

  // `@description("…") def x` - the definition behind annotations on its line
  private def definition(trimmed: String): String = trimmed match
    case Annotation(rest) => definition(rest)
    case other            => other

  private def start(trimmed: String): Option[(Kind, String, String)] =
    definition(trimmed) match
      case TypeStart(n)  => Some((Kind.Type, n, s"type $n"))
      case ObjStart(n)   => Some((Kind.Obj, n, s"object $n"))
      case GivenStart(t) => Some((Kind.Member, t, s"given ${t.replaceAll("\\s+", "")}"))
      case AliasStart(n) => Some((Kind.Member, n, s"type $n"))
      case ValStart(n)   => Some((Kind.Member, n, n))
      case CaseStart(n)  =>
        val name = n.replaceAll("\\s+", "")
        Some((Kind.Case, name, s"case $name"))
      case _             => None

  private def isAttachment(trimmed: String) =
    trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("@")

  private def indentOf(l: String) = l.indexWhere(_ != ' ') match
    case -1 => l.length
    case i  => i

  /** The parts of the lines `from` until `until` whose definitions start at `level`. */
  private def parts(lines: Seq[String], from: Int, until: Int, level: Int): Seq[Part] =
    val out     = Seq.newBuilder[Part]
    var current = Option.empty[(Kind, String, String, Int, Int)]
    var pending = -1
    def close(end: Int): Unit =
      current.foreach: (kind, name, key, first, at) =>
        val last = (end - 1 to at by -1).find(j => !lines(j).isBlank).getOrElse(at)
        out += Part(kind, name, key, first, at, last + 1)
      current = None
    for i <- from until until do
      val l = lines(i)
      if !l.isBlank && indentOf(l) == level then
        val t = l.trim
        start(t) match
          case Some((kind, name, key)) =>
            val first = if pending >= 0 then pending else i
            close(first)
            current = Some((kind, name, key, first, i))
            pending = -1
          case None                    =>
            if current.exists((_, name, _, _, _) => t == s"end $name") then
              pending = -1
              close(i + 1)
            else if isAttachment(t) then
              if pending < 0 then pending = i
            else if pending >= 0 && t.startsWith(")") then () // the end of a multi-line annotation
            else pending = -1 // a line of the current part (`)`, `extends …`)
    close(if pending >= 0 then pending else until)
    // the same key twice (overloaded `def`s): numbered
    val all = out.result()
    all.zipWithIndex.map: (p, i) =>
      val n = all.take(i).count(_.key == p.key)
      if n == 0 then p else p.copy(key = s"${p.key}#$n")
  end parts

  /** The lines that close a head: `:` at the end, outside the parameters. */
  private def headEnd(lines: Seq[String], p: Part): Int =
    val level = indentOf(lines(p.at))
    val open  = balance(lines(p.at)) > 0
    val close =
      if !open then p.at
      else (p.at + 1 until p.until).find(j => indentOf(lines(j)) == level && lines(j).trim.startsWith(")")).getOrElse(p.at)
    // `trait X` + `  extends Dsl:` - a continuation of the head
    var end   = close
    while
      !lines(end).trim.endsWith(":") && end + 1 < p.until && {
        val next = (end + 1 until p.until).find(j => !lines(j).isBlank)
        next.exists(j => Seq("extends", "with", "derives").exists(w => lines(j).trim.startsWith(s"$w ")) && indentOf(lines(j)) > level) &&
        { end = next.get; true }
      }
    do ()
    end

  /** A container: its head, its body (from, until) and its `end X` line. */
  private case class Split(head: Seq[String], body: Option[(Int, Int)], foot: Option[String])

  private def split(lines: Seq[String], p: Part): Split =
    val end   = headEnd(lines, p)
    val level = indentOf(lines(p.at))
    if !lines(end).trim.endsWith(":") || p.kind == Kind.Case || p.kind == Kind.Member then
      Split(lines.slice(p.from, p.until), None, None)
    else
      val last = lines(p.until - 1)
      val foot = Option.when(indentOf(last) == level && last.trim == s"end ${p.name}")(last)
      Split(lines.slice(p.from, end + 1), Some(end + 1 -> (if foot.isDefined then p.until - 1 else p.until)), foot)

  private def levelOf(lines: Seq[String], from: Int, until: Int): Option[Int] =
    (from until until).find(j => !lines(j).isBlank && !isAttachment(lines(j).trim)).map(j => indentOf(lines(j)))

  // ── the merge ───────────────────────────────────────────────────────────────────────────

  private def file(c: Seq[String], s: Seq[String], drop: Boolean): (Seq[String], Seq[String]) =
    val cFirst = firstPart(c)
    val sFirst = firstPart(s)
    val header = withImports(c.take(cFirst), s.take(sFirst))
    val (body, removable) = level(c, cFirst, c.size, 0, s, sFirst, s.size, 0, "", drop)
    (header ++ body, removable)

  // the first line at the top level that is a definition (or its doc comment) - before it the
  // package clauses, the imports and the comments of the file
  private def firstPart(lines: Seq[String]): Int =
    parts(lines, 0, lines.size, 0).headOption.map(_.from).getOrElse(lines.size)

  /** The header of the code with the imports of the spec it does not cover - after its last import. */
  private def withImports(code: Seq[String], spec: Seq[String]): Seq[String] =
    val missing = spec.filter(_.startsWith("import ")).filterNot(i => OrchSpecImports.covered(code, i))
    if missing.isEmpty then code
    else
      val last = code.lastIndexWhere(_.startsWith("import "))
      if last >= 0 then code.patch(last + 1, missing, 0)
      else
        val pkg = code.lastIndexWhere(_.startsWith("package "))
        code.patch(pkg + 1, "" +: missing, 0)

  /** The parts of one level of the code (`cFrom` until `cUntil`, indented by `cLevel`) with those of
    * the spec - see the table above.
    */
  private def level(
      c: Seq[String], cFrom: Int, cUntil: Int, cLevel: Int,
      s: Seq[String], sFrom: Int, sUntil: Int, sLevel: Int,
      owner: String, drop: Boolean
  ): (Seq[String], Seq[String]) =
    val cParts    = parts(c, cFrom, cUntil, cLevel)
    val sParts    = parts(s, sFrom, sUntil, sLevel)
    val shift     = cLevel - sLevel
    val sKeys     = sParts.map(_.key).toSet
    val cKeys     = cParts.map(_.key).toSet
    val names     = (sParts ++ cParts).filter(p => p.kind == Kind.Type && sKeys(p.key)).map(_.name).toSet
    val out       = Seq.newBuilder[String]
    val removable = Seq.newBuilder[String]
    // a class, an object, a case only the code has - an object of a type that stays is its companion
    // a class, object, case or declared field (a shared field of an enum) only the code has - an
    // object of a type that stays is its companion
    def removableCode(p: Part) =
      !sKeys(p.key) && (p.kind == Kind.Type || p.kind == Kind.Case || declaration(c, p) ||
        (p.kind == Kind.Obj && !names(p.name) && !sKeys(s"type ${p.name}")))
    def qualified(p: Part) = if owner.isEmpty then p.name else s"$owner.${p.name}"
    // the spec parts only it has, after the spec part they follow that the code has too (None: before all)
    val anchored  = sParts.zipWithIndex.filterNot((p, _) => cKeys(p.key)).groupBy: (_, i) =>
      sParts.take(i).reverse.find(p => cKeys(p.key)).map(_.key)
    def added(anchor: Option[String]): Seq[String] =
      anchored.getOrElse(anchor, Seq.empty).sortBy(_._2).flatMap: (p, i) =>
        val ls = reindent(s.slice(p.from, p.until), shift)
        // before the first part of the code: with the gap that follows it in the spec - otherwise
        // with the one before it
        if anchor.isEmpty && cParts.nonEmpty then ls ++ (if i + 1 < sParts.size then s.slice(p.until, sParts(i + 1).from) else Seq(""))
        else (if i == 0 then Seq.empty else s.slice(sParts(i - 1).until, p.from)) ++ ls
    val first     = cParts.headOption.map(_.from).getOrElse(cUntil)
    // what comes before the first part of the code (blank lines after the head)
    out ++= c.slice(cFrom, first)
    out ++= added(None)
    var prevEnd   = first
    cParts.foreach: p =>
      if removableCode(p) then removable += qualified(p)
      // a part that goes takes the gap before it with it
      if !(drop && removableCode(p)) then
        out ++= c.slice(prevEnd, p.from)
        val (lines, inner) = both(c, p, s, sParts.find(_.key == p.key), shift, qualified(p), drop)
        out ++= lines
        removable ++= inner
        out ++= added(Some(p.key))
      prevEnd = p.until
    // after the last part: blank lines, the end of the file
    out ++= c.slice(prevEnd, cUntil)
    (out.result(), removable.result().distinct)
  end level

  /** One part of the code with the one of the spec of the same key - if there is one. */
  private def both(
      c: Seq[String], cp: Part, s: Seq[String], sp: Option[Part], shift: Int, name: String, drop: Boolean
  ): (Seq[String], Seq[String]) =
    val code = c.slice(cp.from, cp.until)
    sp match
      case None                                                => code -> Seq.empty
      case Some(p) if compact(code) == compact(s.slice(p.from, p.until)) => code -> Seq.empty
      case Some(p) if cp.kind == Kind.Member || cp.kind == Kind.Case || p.kind == Kind.Member || p.kind == Kind.Case =>
        val spec = s.slice(p.from, p.until)
        (if placeholder(spec) then code else reindent(spec, shift)) -> Seq.empty
      case Some(p)                                             =>
        val cs = split(c, cp)
        val ss = split(s, p)
        val head = if compact(cs.head) == compact(ss.head) then cs.head else reindent(ss.head, shift)
        (cs.body, ss.body) match
          case (None, None)                       => head -> Seq.empty
          case (None, Some((from, until)))        =>
            (head ++ reindent(s.slice(from, until), shift) ++ ss.foot.map(f => reindent(Seq(f), shift)).getOrElse(Seq.empty)) -> Seq.empty
          case (Some((from, until)), None)        =>
            // a body of its own (own `def`s) - the head of the spec needs the colon for it
            val withColon = if head.last.trim.endsWith(":") then head else head.init :+ s"${head.last}:"
            (withColon ++ c.slice(from, until) ++ cs.foot.toSeq) -> Seq.empty
          case (Some((cFrom, cUntil)), Some((sFrom, sUntil))) =>
            val cLevel       = levelOf(c, cFrom, cUntil)
            val sLevel       = levelOf(s, sFrom, sUntil)
            val bodyLevel    = cLevel.getOrElse(sLevel.map(_ + shift).getOrElse(0))
            val specLevel    = sLevel.getOrElse(bodyLevel - shift)
            val (body, more) = level(c, cFrom, cUntil, bodyLevel, s, sFrom, sUntil, specLevel, name, drop)
            (head ++ body ++ cs.foot.orElse(ss.foot.map(f => reindent(Seq(f), shift).head)).toSeq) -> more
        end match
    end match
  end both

  /** A `def` or `val` without a value - `def readFromFcs: Option[Boolean]`, the shared field of an
    * enum: what the spec declares, no implementation.
    */
  private def declaration(lines: Seq[String], p: Part): Boolean =
    p.kind == Kind.Member && (definition(lines(p.at).trim) match
      case ValStart(_) => !lines.slice(p.at, p.until).map(_.replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "")).exists(_.contains("="))
      case _           => false)

  // `???` or a `TODO` of the generator: the code has its implementation there
  private def placeholder(spec: Seq[String]): Boolean =
    spec.exists(l => l.contains("???") || l.trim.startsWith("// TODO") || l.contains("/* TODO"))

  private def reindent(lines: Seq[String], shift: Int): Seq[String] =
    if shift == 0 then lines
    else if shift > 0 then lines.map(l => if l.isBlank then l else " " * shift + l)
    else lines.map(l => l.drop(math.min(-shift, indentOf(l))))

  private def compact(lines: Seq[String]): String = compact(lines.mkString("\n"))
  private def compact(text: String): String       = text.replaceAll("\\s+", "")

  // parentheses outside of strings and line comments
  private def balance(l: String): Int =
    l.replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "").split("//").headOption.getOrElse("")
      .foldLeft(0)((d, ch) => if ch == '(' then d + 1 else if ch == ')' then d - 1 else d)

end ScalaMerge
