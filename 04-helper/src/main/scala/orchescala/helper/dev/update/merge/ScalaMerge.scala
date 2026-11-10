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
  *
  * No parser: it reads the code as the generator writes it and a developer extends it - every
  * definition on a line of its own, a body indented deeper than its head, ending at the next line
  * of its level (or its `end X`). Known are `class`, `trait`, `enum`, `object`, `case`, `val`,
  * `var`, `def`, `given`, `type`, `extension`, `import` and `export`, each after modifiers and annotations; a
  * head over several lines (parameters, `extends`/`with`/`derives`) belongs to it. Another line of
  * a level continues the definition before it.
  */
object ScalaMerge:

  /** @param text      the code with what the spec generates - what only the code has stays
    * @param removable the classes, objects and cases only the code has (`Out.Legacy`) - in `text`
    * @param without   `text` without them
    */
  case class Result(text: String, removable: Seq[String], without: String)

  def merge(code: String, spec: String): Result =
    val c                    = code.split("\n", -1).toSeq
    val s                    = spec.split("\n", -1).toSeq
    val (text, removable)    = file(c, s, drop = false)
    val (without, _)         = file(c, s, drop = true)
    Result(text.mkString("\n"), removable, without.mkString("\n"))

  /** @param names the classes and objects of a file Orch Spec does not give (any more)
    * @param rest  the file without them - None when nothing else is in it (only the package, the
    *              imports and comments): the file can go
    */
  case class Orphaned(names: Seq[String], rest: Option[String])

  /** What goes of a file Orch Spec does not give: its classes and objects - not what else is in it
    * (top-level `def`s, `given`s, extensions): with that the file stays, without them.
    */
  def orphaned(code: String): Orphaned =
    val c             = code.split("\n", -1).toSeq
    val first         = firstPart(c)
    val (body, names) = level(c, first, c.size, 0, Seq.empty, 0, 0, 0, "", drop = true)
    val code_         = body.map(_.trim).filterNot(l => l.isEmpty || isAttachment(l))
    // the gap before a class that goes stays with the header
    Orphaned(names, Option.when(code_.nonEmpty)((c.take(first) ++ body.dropWhile(_.isBlank)).mkString("\n")))

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
  private val ExtStart   = """extension\b\s*(.*?):?""".r
  private val ImportLine = """import\s+(.+)""".r
  private val ExportLine = """export\s+(.+)""".r
  // `@description("…") def x` - the definition behind annotations on its line; an annotation
  // whose arguments do not end on the line is one alone
  private def definition(trimmed: String): String =
    if !trimmed.startsWith("@") then trimmed
    else
      val name = trimmed.drop(1).takeWhile(ch => ch.isLetterOrDigit || ch == '_' || ch == '.')
      val rest = trimmed.drop(1 + name.length)
      val next = if rest.startsWith("(") then argumentsEnd(rest).map(rest.drop) else Some(rest)
      next match
        case Some(r) if name.nonEmpty && r.nonEmpty && r.head.isWhitespace && r.trim.nonEmpty => definition(r.trim)
        case _                                                                               => trimmed

  // the index after the `)` closing the `(` at 0 - outside strings; None when it is not on the line
  private def argumentsEnd(s: String): Option[Int] =
    @annotation.tailrec
    def go(i: Int, depth: Int, inString: Boolean): Option[Int] =
      if i >= s.length then None
      else
        val ch = s(i)
        if inString then
          if ch == '\\' then go(i + 2, depth, true) else go(i + 1, depth, ch != '"')
        else if ch == '"' then go(i + 1, depth, true)
        else if ch == '(' then go(i + 1, depth + 1, false)
        else if ch == ')' then (if depth == 1 then Some(i + 1) else go(i + 1, depth - 1, false))
        else go(i + 1, depth, false)
    go(0, 0, false)

  /** Per line: does it start inside a `"""` string or a block comment? Such a line is no definition. */
  private def continued(lines: Seq[String]): IndexedSeq[Boolean] =
    enum In:
      case Code, Text, Comment
    // the state at the end of a line from the one at its start - (state, depth of nested comments)
    def scan(l: String, start: (In, Int)): (In, Int) =
      @annotation.tailrec
      def go(i: Int, in: In, depth: Int): (In, Int) =
        if i >= l.length then (in, depth)
        else
          in match
            case In.Text    => if l.startsWith("\"\"\"", i) then go(i + 3, In.Code, 0) else go(i + 1, in, depth)
            case In.Comment =>
              if l.startsWith("*/", i) then (if depth == 1 then go(i + 2, In.Code, 0) else go(i + 2, in, depth - 1))
              else if l.startsWith("/*", i) then go(i + 2, in, depth + 1)
              else go(i + 1, in, depth)
            case In.Code    =>
              if l.startsWith("//", i) then (in, depth)
              else if l.startsWith("/*", i) then go(i + 2, In.Comment, 1)
              else if l.startsWith("\"\"\"", i) then go(i + 3, In.Text, 0)
              else if l(i) == '"' then go(stringEnd(l, i + 1), in, depth)
              else if l(i) == '\'' && i + 2 < l.length && l(i + 2) == '\'' then go(i + 3, in, depth)
              else go(i + 1, in, depth)
      go(0, start._1, start._2)
    lines.scanLeft((In.Code, 0))((state, l) => scan(l, state)).init.map(_._1 != In.Code).toIndexedSeq

  // the index after the `"` closing a string that starts before `from`
  @annotation.tailrec
  private def stringEnd(l: String, from: Int): Int =
    if from >= l.length then l.length
    else if l(from) == '\\' then stringEnd(l, from + 2)
    else if l(from) == '"' then from + 1
    else stringEnd(l, from + 1)

  private def start(trimmed: String): Option[(Kind, String, String)] =
    definition(trimmed) match
      case TypeStart(n)  => Some((Kind.Type, n, s"type $n"))
      case ObjStart(n)   => Some((Kind.Obj, n, s"object $n"))
      case GivenStart(t) => Some((Kind.Member, t, s"given ${t.replaceAll("\\s+", "")}"))
      case AliasStart(n) => Some((Kind.Member, n, s"type $n"))
      case ExtStart(on)  => Some((Kind.Member, "extension", s"extension ${on.replaceAll("\\s+", "")}"))
      case ImportLine(i) => Some((Kind.Member, "import", s"import ${i.replaceAll("\\s+", "")}"))
      case ExportLine(e) => Some((Kind.Member, "export", s"export ${e.replaceAll("\\s+", "")}"))
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
    val inside  = continued(lines)
    for i <- from until until do
      val l = lines(i)
      if !l.isBlank && !inside(i) && indentOf(l) == level then
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
    out.result().foldLeft((Vector.empty[Part], Map.empty[String, Int])): (acc, p) =>
      val (done, seen) = acc
      val n            = seen.getOrElse(p.key, 0)
      (done :+ (if n == 0 then p else p.copy(key = s"${p.key}#$n")), seen.updated(p.key, n + 1))
    ._1
  end parts

  /** The lines that close a head: `:` at the end, outside the parameters. */
  private def headEnd(lines: Seq[String], p: Part): Int =
    val level = indentOf(lines(p.at))
    val open  = balance(lines(p.at)) > 0
    val close =
      if !open then p.at
      else (p.at + 1 until p.until).find(j => indentOf(lines(j)) == level && lines(j).trim.startsWith(")")).getOrElse(p.at)
    // `trait X` + `  extends Dsl:` - a continuation of the head
    def continues(j: Int) =
      indentOf(lines(j)) > level && Seq("extends", "with", "derives").exists(w => lines(j).trim.startsWith(s"$w "))
    @annotation.tailrec
    def headUntil(end: Int): Int =
      if lines(end).trim.endsWith(":") then end
      else (end + 1 until p.until).find(j => !lines(j).isBlank) match
        case Some(j) if continues(j) => headUntil(j)
        case _                       => end
    headUntil(close)

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
    parts(lines, 0, lines.size, 0).find(_.name != "import").map(_.from).getOrElse(lines.size)

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
      // a value is an `=` outside of strings and comments - not one of `=>`, `==`, `!=`, `<=`, `>=`
      case ValStart(_) => !"(?<![=!<>])=(?![=>])".r.findFirstIn(withoutComments(lines.slice(p.at, p.until))).isDefined
      case _           => false)

  // the lines without their strings and comments
  private def withoutComments(lines: Seq[String]): String =
    lines.mkString("\n")
      .replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "\"\"")
      .replaceAll("(?s)/\\*.*?\\*/", "")
      .replaceAll("//[^\n]*", "")

  // `???` or a `TODO` of the generator: the code has its implementation there - not a `???` in a string
  private def placeholder(spec: Seq[String]): Boolean =
    spec.exists(l => l.replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "\"\"").contains("???") || l.trim.startsWith("// TODO") || l.contains("/* TODO"))

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
