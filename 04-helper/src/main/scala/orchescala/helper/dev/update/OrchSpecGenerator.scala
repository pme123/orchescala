package orchescala.helper.dev.update

import orchescala.domain.BpmnProcessType
import orchescala.helper.dev.update.merge.{MergePlan, OnConflict, ProcessExport, ServicesExport, SpecMerge}

/** Creates a process from the exports of Orch Spec:
  *   - the BPMN export - the process id gives the names (process, version, object); without it the
  *     BPMN template is created,
  *   - the Scala export - the domain classes of the process.
  *
  * Besides the domain classes and the BPMN it creates the workers of the process (init worker,
  * custom tasks, signal- and message events) and the simulation - like `./helper.scala process`
  * does - and registers them in the `WorkerApp` and the `ApiProjectCreator`.
  *
  * The command can be re-run after changes in Orch Spec: the domain classes are merged into the code
  * by structure (`merge.ScalaMerge` - the own members stay, what only the code has goes only on a
  * yes), the process object gets the types from Orch Spec (`OrchSpecProcessObject.merge`); workers
  * and the BPMN that exist are not overwritten.
  *
  * The decision is the plan of the merge from Orch Spec without a base (`merge.SpecMerge`): the
  * library decides and writes, only this command prints.
  */
final class OrchSpecGenerator(
    /** the question whether what only the code has goes - the console by default */
    ask: String => Option[String] = MergeReport.readAnswer
)(using config: DevConfig):

  /** «Process from Spec» of one process (`orchspec:` or pasted): decide (the plan, without a base),
    * ask whether what only the code has goes, write it, print it.
    */
  def createProcess(bpmn: Option[String], scalaExport: String, dmns: Seq[(String, String)] = Seq.empty): Unit =
    val project = config.projectDir
    val plan    = SpecMerge.plan(project, Seq.empty, Seq(ProcessExport("orchspec", bpmn, scalaExport, dmns)), strict = true)
    mergeAndPrint(project, plan)
    linkDiagrams(project)
  end createProcess

  /** «Process from Spec» of a service collection or a service orchestration (`orchspec:` v2) - the
    * same plan without a base as for a process (see `merge.ServicePlanner`): new files are created,
    * the domain classes merged into the code, the registrations added.
    */
  def createServices(scalaExport: String): Unit =
    val project = config.projectDir
    val plan    = SpecMerge.plan(project, Seq.empty, Seq(ServicesExport("orchspec", scalaExport)), strict = true)
    mergeAndPrint(project, plan)
  end createServices

  // what only the code has: the plan with its changes first, then the question - it goes only on
  // a yes; without it the changes are shown with what the merge did
  private def mergeAndPrint(project: os.Path, plan: MergePlan): Unit =
    if plan.removals.isEmpty then
      val before = MergeReport.before(project, plan)
      MergeReport.printMerged(plan, SpecMerge.merge(project, plan, OnConflict.KeepCode), project, Some(before))
    else
      MergeReport.printPlan(plan, project)
      val remove = MergeReport.askRemoval(plan, ask)
      MergeReport.printMerged(plan, SpecMerge.merge(project, plan, OnConflict.KeepCode, remove), project)

  /** The worker app serves the diagrams in its docs - a project set up before its first BPMN has no link yet. */
  def linkDiagrams(project: os.Path): Unit =
    SetupGenerator.ensureDiagramsLink(project) match
      case SetupGenerator.DiagramsLink.Linked            =>
        println(s"${Console.GREEN}Linked 03-worker/src/main/resources/diagrams -> src/main/resources/camunda${Console.RESET}")
      case SetupGenerator.DiagramsLink.NoWorkerResources =>
        println(
          s"${Console.YELLOW}WARNING: no 03-worker/src/main/resources - the worker app cannot serve the diagrams (its docs answer 404, the gateway 502)${Console.RESET}"
        )
      case SetupGenerator.DiagramsLink.Failed(reason)    =>
        println(
          s"${Console.YELLOW}WARNING: 03-worker/src/main/resources/diagrams -> src/main/resources/camunda not linked ($reason) - the docs miss the diagrams${Console.RESET}"
        )
      case SetupGenerator.DiagramsLink.Exists | SetupGenerator.DiagramsLink.NoDiagrams => ()

end OrchSpecGenerator

/** The names of the process - `kundenkontaktDokumentieren`, `1`, `KundenkontaktDokumentieren`. */
case class OrchSpecNames(processName: String, version: Int, objectName: String):
  override def toString = s"$processName v$version ($objectName)"

object OrchSpecNames:
  private val Versioned = """([A-Za-z][A-Za-z0-9]*?)V(\d+)""".r

  /** The name of the process object: the exported one (the object Orch Spec knows from the domain)
    * as long as its file exists - otherwise the name derived from the process (without the version).
    */
  def objectName(exported: Option[String], derived: String, exists: String => Boolean): String =
    exported.filter(exists).getOrElse(derived)

  /** The names from the process id - the same way Orch Spec derives them:
    *   - `acme-addresschange-kundenkontakt-dokumentieren` -> `kundenkontaktDokumentieren`, 1, `KundenkontaktDokumentieren`
    *   - `globex-savings-openSavingsV2` -> `openSavings`, 2, `OpenSavings` (the version is in the package)
    */
  def apply(processId: String, projectName: String): OrchSpecNames =
    val bare = processId.stripPrefix(s"$projectName-")
    bare match
      case Versioned(name, version) =>
        OrchSpecNames(name, version.toInt, s"${name.head.toUpper}${name.tail}")
      case _                        =>
        val parts = bare.split("[^A-Za-z0-9]+").toSeq.filter(_.nonEmpty)
        val name  =
          if parts.size > 1 && bare == projectName then parts.last
          else if parts.isEmpty then "process"
          else (parts.head +: parts.tail.map(p => s"${p.head.toUpper}${p.tail}")).mkString
        OrchSpecNames(name, 1, s"${name.head.toUpper}${name.tail}")
    end match
  end apply
end OrchSpecNames

/** One file of the Scala export - `insert` marks the content of the process object. */
case class OrchSpecFile(path: os.RelPath, content: String, insert: Boolean = false)

/** Registers the process in an object like the `WorkerApp` or the `ApiProjectCreator`:
  * {{{
  * object WorkerApp extends CompanyWorkerApp:
  *   workers(
  *     myProcessWorkers,        // name - added to the list
  *     ..
  *   )
  *   ..
  *   private lazy val myProcessWorkers =   // block - added at the end
  *     import ..
  *     Seq(
  *       MyProcessWorker(),     // entries
  *     )
  *   end myProcessWorkers
  * end WorkerApp
  * }}}
  * Is the block already there (a re-run), the missing entries are added to it.
  */
case class OrchSpecRegistration(
    objectName: String,
    listStart: String,
    name: String,
    // `MyProcessWorker()` / `MyUserTaskUT.example`
    entries: Seq[String],
    block: Seq[String] => String,
    // the package of the entries (`a.b.worker.persons.v2`) - a worker of the same name from
    // another package is no duplicate (see `register`)
    entriesPackage: Option[String] = None
):
  import OrchSpecRegistration.Elsewhere

  def register(content: String): RegistrationResult =
    val lines  = content.linesIterator.toSeq
    val hidden = commented(lines)
    val start  = blockStart(lines, hidden)
    if start >= 0 then addEntries(lines, start)
    else
      // a worker (`MyProcessWorker()`) registered elsewhere already from the same package - a block
      // of another name (`lilaSetV2Workers` for `lilaSet` v2): a second registration would
      // subscribe the same topic twice. A worker of the same name from another package (another
      // API or version: `persons.v1` for `persons.v2`) has a topic of its own - it is added.
      val elsewhere = registeredElsewhere(lines, hidden)
      val left      = entries.filterNot(e => elsewhere.get(e).exists(_ != Elsewhere.Absent))
      if left.isEmpty then RegistrationResult.Unchanged
      else copy(entries = left).addBlock(lines)
    end if
  end register

  /** The entries `register` leaves out, though it is not sure they are registered from their
    * package - a worker of that name comes from one of several wildcard imports. For a note.
    */
  def unsure(content: String): Seq[String] =
    val lines  = content.linesIterator.toSeq
    val hidden = commented(lines)
    if blockStart(lines, hidden) >= 0 then Seq.empty
    else
      val elsewhere = registeredElsewhere(lines, hidden)
      entries.filter(e => elsewhere.get(e).contains(Elsewhere.Maybe))
  end unsure

  private def blockStart(lines: Seq[String], hidden: Set[Int]): Int =
    lines.indices.indexWhere(i =>
      !hidden(i) && lines(i).matches(s"""$leadingComments(private\\s+)?lazy val $name\\s*=.*""")
    )

  // how each worker entry (`MyWorker()`) is registered elsewhere in `lines` already
  private def registeredElsewhere(lines: Seq[String], hidden: Set[Int]): Map[String, Elsewhere] =
    val workers = entries.filter(_.endsWith("()"))
    if workers.isEmpty then Map.empty
    else
      val found = registeredFrom(lines, hidden, entriesPackage)
      workers.map(e => e -> found(e.stripSuffix("()"))).toMap
  end registeredElsewhere

  /** Is a worker (`key`) registered in `lines` from the package `own`? A name is resolved roughly
    * as Scala does - from the nearest scope that may bind it: an explicit import in its block
    * (`lazy val … end …`, also under another name, `{Key as Other}`), a wildcard import in its
    * block, an explicit import outside any block, a wildcard import there - else a package of the
    * file. Imports in other blocks or after the usage are not in scope; other scopes (a nested
    * `object`, a `def`) are not told apart - their imports count as outside any block.
    *
    * Several wildcard imports of that nearest scope may bring the name: `Maybe` if one of them is
    * `own` - `register` skips it (a duplicate registration subscribes a topic twice, a missing
    * block the developer sees), `unsure` names it for a note. A qualified `x.y.Key()` resolves `x`
    * by an explicit import, else by the wildcard imports and the packages of the file, or is a
    * full package itself. Without `own` (no `entriesPackage`) any registration of the name counts.
    */
  private def registeredFrom(lines: Seq[String], hidden: Set[Int], own: Option[String]): String => Elsewhere =
    import OrchSpecRegistration.imports
    val visible   = lines.indices.filter(i => !hidden(i) && !lines(i).trim.startsWith("//"))
    val imported  = imports(visible.map(lines)).map((at, pkg, names) => (visible(at), pkg, names))
    lazy val blockOf   = blocksOf(lines, hidden)
    // `package a.b` + `package worker`: the members of a.b.worker and of a.b are in scope
    lazy val enclosing =
      val clauses = visible.flatMap(i => OrchSpecRegistration.packageClause.findFirstMatchIn(lines(i)).map(_.group(1)))
      clauses.inits.filter(_.nonEmpty).map(_.mkString(".")).toSeq
    type Imported = Seq[(Int, String, Map[String, String])]
    def explicit(in: Imported, name: String) =
      in.flatMap((_, pkg, names) => names.get(name).filter(_ != "*").map(n => s"$pkg.$n")).distinct
    def wildcard(in: Imported, name: String) =
      in.collect { case (_, pkg, names) if names.contains("*") => s"$pkg.$name" }.distinct
    // the imports in scope at line `i`: in its block, outside any block
    def inScope(i: Int): (Imported, Imported) =
      imported
        .filter((j, _, _) => j < i && blockOf(j).forall(b => blockOf(i).contains(b)))
        .partition((j, _, _) => blockOf(j).isDefined)
    // the full names a worker `name` can stand for at line `i` - and whether several wildcards
    // of the nearest scope bring it
    def resolve(i: Int, name: String): (Seq[String], Boolean) =
      val (block, outside) = inScope(i)
      LazyList(explicit(block, name) -> false, wildcard(block, name) -> true, explicit(outside, name) -> false, wildcard(outside, name) -> true)
        .find(_._1.nonEmpty)
        .map((names, wild) => names -> (wild && names.size > 1))
        .getOrElse(enclosing.map(p => s"$p.$name") -> false)
    // the packages the first part of a qualified name can stand for at line `i`
    def resolveHead(i: Int, head: String): Seq[String] =
      val (block, outside) = inScope(i)
      val explicitOnes     = explicit(block, head) ++ explicit(outside, head)
      if explicitOnes.nonEmpty then explicitOnes
      else wildcard(block, head) ++ wildcard(outside, head) ++ enclosing.map(p => s"$p.$head")
    key =>
      // the names the worker goes by: its own and those it is imported as
      val names = (key +: imported.flatMap(_._3.collect { case (as, `key`) => as })).distinct
      val usage = s"""(?<![\\w.])((?:\\w+\\.)*)(${names.mkString("|")})\\(""".r
      val found = visible.flatMap: i =>
        usage.findAllMatchIn(lines(i)).map(m => (i, m.group(1).stripSuffix("."), m.group(2)))
      own match
        case None      => if found.exists(_._3 == key) then Elsewhere.Same else Elsewhere.Absent
        case Some(pkg) =>
          val each = found.map:
            case (i, "", name)        =>
              val (candidates, several) = resolve(i, name)
              if !candidates.contains(s"$pkg.$key") then Elsewhere.Absent
              else if several then Elsewhere.Maybe
              else Elsewhere.Same
            case (i, qualifier, name) =>
              val (head, rest) = qualifier.span(_ != '.')
              if name == key && (qualifier +: resolveHead(i, head).map(_ + rest)).contains(pkg) then Elsewhere.Same
              else Elsewhere.Absent
          if each.contains(Elsewhere.Same) then Elsewhere.Same
          else if each.contains(Elsewhere.Maybe) then Elsewhere.Maybe
          else Elsewhere.Absent
      end match
  end registeredFrom

  /** For each line the start of the innermost `lazy val … end …` block it is in - if it is in one. */
  private def blocksOf(lines: Seq[String], hidden: Set[Int]): Vector[Option[Int]] =
    val start  = s"""$leadingComments(?:private\\s+)?lazy val (\\w+)\\s*=.*""".r
    val ranges = lines.indices.filterNot(hidden).flatMap: i =>
      lines(i) match
        case start(n) =>
          val end = lines.indexWhere(_.trim == s"end $n", i)
          if end < 0 then Seq.empty else Seq(i -> end)
        case _        => Seq.empty
    lines.indices.toVector.map(i => ranges.filter((s, e) => s <= i && i <= e).maxByOption(_._1).map(_._1))
  end blocksOf

  /** Removes what Orch Spec no longer has: the `removed` entries from the block - or, with
    * `wholeBlock` (the process is gone), the block itself and its name in the list. Comments and
    * everything else stay. The content as it is if there is nothing to remove.
    */
  def unregister(content: String, removed: Seq[String], wholeBlock: Boolean): String =
    val lines  = content.linesIterator.toSeq
    val hidden = commented(lines)
    val start  = lines.indices.indexWhere(i =>
      !hidden(i) && lines(i).matches(s"""$leadingComments(private\\s+)?lazy val $name\\s*=.*""")
    )
    val end    = if start < 0 then -1 else lines.indexWhere(_.trim == s"end $name", start)
    if end < 0 then content
    else if wholeBlock then
      // the block with the blank line before it, and its name in the list
      val from    = if start > 0 && lines(start - 1).isBlank then start - 1 else start
      val cut     = lines.patch(from, Nil, end + 1 - from)
      // no blank line left behind: before the end of the object, or a second one
      val blank   = cut.lift(from).exists(_.isBlank) &&
        (cut.lift(from + 1).exists(_.trim == s"end $objectName") || from > 0 && cut(from - 1).isBlank)
      val without = if blank then cut.patch(from, Nil, 1) else cut
      val list    = without.indexWhere(_.trim == listStart)
      val close   = if list < 0 then -1 else without.indexWhere(_.trim == ")", list + 1)
      val entry   =
        if close < 0 then None
        else (list + 1 until close).find(i => without(i).trim.stripSuffix(",").trim == name)
      entry.fold(without)(i => without.patch(i, Nil, 1)).mkString("\n") + "\n"
    else
      val keys = removed.toSet
      val kept = lines.zipWithIndex.collect:
        case (l, i) if !(i > start && i < end && keys.contains(l.trim.stripSuffix(",").trim)) => l
      if kept.size == lines.size then content else kept.mkString("\n") + "\n"
    end if
  end unregister

  /** The lines that begin inside a block comment (`/* … */`) or a multi-line string - like the
    * example of the generated `ApiProjectCreator`: a block there is no registration, neither the
    * process's own nor a neighbour to sort the new block next to. Read as Scala does: comments
    * nest, and the opener of a comment in a string, a character or after `//` opens none.
    */
  private def commented(lines: Seq[String]): Set[Int] =
    val hidden = Set.newBuilder[Int]
    var depth  = 0     // open block comments
    var triple = false // in a """…""" string - it may span lines
    for (line, i) <- lines.zipWithIndex do
      if depth > 0 || triple then hidden += i
      var single = false // in a "…" string - it ends with the line at the latest
      var j      = 0
      def at(token: String) = line.startsWith(token, j)
      while j < line.length do
        if triple then
          if at("\"\"\"") then triple = false
          j += (if !triple then 3 else 1)
        else if single then
          if line(j) == '"' then single = false
          j += (if line(j) == '\\' then 2 else 1)
        else if depth > 0 then
          if at("/*") then depth += 1
          else if at("*/") then depth -= 1
          j += (if at("/*") || at("*/") then 2 else 1)
        else if at("//") then j = line.length
        else if at("/*") then
          depth += 1
          j += 2
        else if at("\"\"\"") then
          triple = true
          j += 3
        else if line(j) == '"' then
          single = true
          j += 1
        else if line(j) == '\'' then // a character - `'"'`, `'\\''` - opens nothing
          j += (if line.lift(j + 1).contains('\\') then 4 else 3)
        else j += 1
        end if
      end while
    end for
    hidden.result()
  end commented

  // `/* … */` in front of a `lazy val` on the same line - still the registration
  private val leadingComments = """\s*(?:/\*.*?\*/\s*)*"""

  def snippet(missing: Seq[String]): String =
    s"""  $listStart
       |    $name,
       |    ..
       |  )
       |
       |${block(missing)}""".stripMargin

  private def addBlock(lines: Seq[String]): RegistrationResult =
    val list = lines.indexWhere(_.trim == listStart)
    val end  = lines.indexWhere(_.trim == s"end $objectName")
    if list < 0 || end < list then
      RegistrationResult.Manual(s"$objectName has no `$listStart` or no `end $objectName`.", snippet(entries))
    else
      val withEntry = insertEntry(lines, list)
      RegistrationResult.Registered(
        insertBlock(withEntry, end + withEntry.size - lines.size).mkString("\n") + "\n",
        Seq(name)
      )
    end if
  end addBlock

  // alphabetically next to its neighbour: after the closest name before it, else before the
  // closest after it - the order of the others stays (in `document(…)` it is the order of the docs)
  private def neighbours(names: Seq[(Int, String)]): (Option[Int], Option[Int]) =
    val before = names.filter(_._2.compareToIgnoreCase(name) < 0)
    val after  = names.filter(_._2.compareToIgnoreCase(name) > 0)
    (
      before.maxByOption(_._2.toLowerCase).map(_._1),
      after.minByOption(_._2.toLowerCase).map(_._1)
    )
  end neighbours

  /** The name alphabetically in the list (see `neighbours`). Comments (`//TODO add workers here`)
    * are no entries. Trailing commas are fine - the closing parenthesis is always on its own line.
    */
  private def insertEntry(lines: Seq[String], list: Int): Seq[String] =
    val entry = " " * (indentOf(lines(list)) + 2) + s"$name,"
    val close = lines.indexWhere(_.trim == ")", list + 1)
    val items =
      if close < 0 then Seq.empty
      else
        (list + 1 until close)
          .filter(i => !lines(i).isBlank && !lines(i).trim.startsWith("//"))
          .map(i => i -> lines(i).trim.stripSuffix(",").trim)
    neighbours(items) match
      case (Some(i), _)    =>
        val comma = if lines(i).stripTrailing.endsWith(",") then lines(i) else lines(i).stripTrailing + ","
        lines.patch(i, Seq(comma, entry), 1)
      case (None, Some(i)) =>
        lines.patch(i, Seq(entry), 0)
      case _               =>
        lines.patch(list + 1, Seq(entry), 0)
    end match
  end insertEntry

  /** The block alphabetically among the blocks of its kind (`…Workers` / `…Api`, see `neighbours`)
    * - after the `end` of the one before, else before the one after (with the comments above it),
    * else at the end of the object.
    */
  private def insertBlock(lines: Seq[String], end: Int): Seq[String] =
    val blockLines = block(entries).linesIterator.toSeq
    val suffix     = "[A-Z][a-z0-9]*$".r.findFirstIn(name).getOrElse("")
    val start      = s"""$leadingComments(?:private\\s+)?lazy val (\\w+$suffix)\\s*=.*""".r
    val hidden     = commented(lines)
    val blocks     = (0 until end).filterNot(hidden).flatMap(i =>
      lines(i) match
        case start(other) => Seq(i -> other)
        case _            => Seq.empty
    )
    val blockEnd   = (i: Int) =>
      val other = blocks.find(_._1 == i).get._2
      Some(lines.indexWhere(_.trim == s"end $other", i)).filter(e => e >= 0 && e < end)
    neighbours(blocks) match
      case (Some(i), _) if blockEnd(i).isDefined =>
        val at    = blockEnd(i).get + 1
        val after = if lines.lift(at).exists(!_.isBlank) then Seq("") else Seq.empty
        lines.patch(at, ("" +: blockLines) ++ after, 0)
      case (_, Some(i))                          =>
        val comments = (i - 1 to 0 by -1).takeWhile(j => lines(j).trim.startsWith("//")).size
        val at       = i - comments
        val before   = if at > 0 && !lines(at - 1).isBlank then Seq("") else Seq.empty
        lines.patch(at, before ++ blockLines :+ "", 0)
      case _                                     =>
        val body = lines.take(end).reverse.dropWhile(_.isBlank).reverse
        body ++ ("" +: blockLines :+ "") ++ lines.drop(end)
    end match
  end insertBlock

  /** A re-run: the block is there - the new entries go before its last closing parenthesis. */
  private def addEntries(lines: Seq[String], start: Int): RegistrationResult =
    val end     = lines.indexWhere(_.trim == s"end $name", start)
    val inBlock = if end < 0 then lines.drop(start) else lines.slice(start, end)
    val missing = entries.filterNot: e =>
      val key = e.takeWhile(c => c.isLetterOrDigit || c == '_')
      inBlock.exists(s"""\\b$key\\b""".r.findFirstIn(_).isDefined)
    val manual  = (reason: String) =>
      RegistrationResult.Manual(reason, s"  // in $name\n${missing.map(e => s"      $e,").mkString("\n")}")
    if missing.isEmpty then RegistrationResult.Unchanged
    else if end < 0 then manual(s"$objectName has no `end $name`.")
    else
      val closing = (start until end).findLast(i => lines(i).trim == ")")
      val empty   = (start until end).findLast(i => lines(i).stripTrailing.endsWith(")()"))
      (closing, empty) match
        // `api(MyProcess.example)()` - the first run had no interactions
        case (_, Some(i)) if closing.forall(_ < i) =>
          val indent = " " * indentOf(lines(i))
          val opened = lines(i).stripTrailing.dropRight(1)
          RegistrationResult.Registered(
            lines.patch(i, (opened +: missing.map(e => s"$indent  $e,")) :+ s"$indent)", 1).mkString("\n") + "\n",
            missing
          )
        case (Some(i), _)                          =>
          val indent = " " * (indentOf(lines(i)) + 2)
          // the last entry may have no trailing comma
          val last   = (start until i).findLast(j => !lines(j).isBlank).get
          val comma  =
            if lines(last).stripTrailing.endsWith(",") || lines(last).stripTrailing.endsWith("(") then lines(last)
            else lines(last).stripTrailing + ","
          RegistrationResult.Registered(
            lines.patch(last, Seq(comma), 1).patch(i, missing.map(e => s"$indent$e,"), 0).mkString("\n") + "\n",
            missing
          )
        case _                                     =>
          manual(s"$name has not the expected form.")
      end match
    end if
  end addEntries

  private def indentOf(line: String) = line.indexWhere(_ != ' ')

end OrchSpecRegistration

object OrchSpecRegistration:

  private val packageClause = """^\s*package\s+([\w.]+)\s*$""".r
  private val importClause  = """^import\s+(.+)$""".r

  /** How a worker is registered elsewhere already: not at all (or from another package), from
    * its package, or perhaps - one of several wildcard imports is its package.
    */
  private enum Elsewhere:
    case Absent, Same, Maybe

  /** The imports in `lines`: the index of the line it starts on, the package and the names it
    * brings - the name in scope to the imported one, `*` for all of it. `import a.b.*`,
    * `import a.b.X`, `import a.b.{X, Y as Z, W => V, given, *}`, `import a.*, c.*` - also over
    * several lines and with a comment or `; …` after it.
    */
  private[dev] def imports(lines: Seq[String]): Seq[(Int, String, Map[String, String])] =
    importClauses(lines).flatMap: (at, clause) =>
      topLevelParts(clause).map(_.trim).filter(_.contains(".")).map: part =>
        val dot = if part.contains('{') then part.indexOf('{') - 1 else part.lastIndexOf('.')
        val sel = part.drop(dot + 1).trim.stripPrefix("{").stripSuffix("}")
        (at, part.take(dot).trim, topLevelParts(sel).flatMap(selector).toMap)
  end imports

  /** The text of each `import` with the index of its line - braces over several lines joined. A
    * brace that is not closed ends at the next `import` or at the end - the imports after it stay.
    */
  private def importClauses(lines: Seq[String]): Seq[(Int, String)] =
    def braces(s: String) = s.count(_ == '{') - s.count(_ == '}')
    // without a comment and what follows a `;`
    val texts                   = lines.map(_.replaceAll("""/\*.*?\*/""", "").replaceAll("""//.*$""", "").takeWhile(_ != ';').trim)
    val (clauses, unterminated) =
      texts.zipWithIndex.foldLeft((Vector.empty[(Int, String)], Option.empty[(Int, String)])):
        case ((done, open), (importClause(text), i)) =>
          val closed = done ++ open
          if braces(text) > 0 then (closed, Some(i -> text)) else (closed :+ (i -> text), None)
        case ((done, Some((at, text))), (line, _))  =>
          val joined = s"$text $line"
          if braces(joined) > 0 then (done, Some(at -> joined)) else (done :+ (at -> joined), None)
        case (acc, _)                               => acc
    clauses ++ unterminated
  end importClauses

  // `X` / `X as Y` / `X => Y` / `*` / `_` - the name in scope to the imported one; `given` and
  // a hidden `X as _` bring no name
  private def selector(s: String): Option[(String, String)] =
    s.trim.split("""\s+as\s+|\s*=>\s*""").toSeq.map(_.trim) match
      case Seq("*") | Seq("_")                  => Some("*" -> "*")
      case Seq(name) if name.matches("""\w+""") => Option.when(name != "given")(name -> name)
      case Seq(name, as) if as != "_"           => Some(as -> name)
      case _                                    => None

  // the parts of `a.*, c.d.{X, Y}` - commas in braces belong to their part
  private def topLevelParts(s: String): Seq[String] =
    val (parts, last, _) = s.foldLeft((Vector.empty[String], "", 0)):
      case ((parts, part, 0), ',')     => (parts :+ part, "", 0)
      case ((parts, part, depth), c) =>
        (parts, part + c, depth + (if c == '{' then 1 else if c == '}' then -1 else 0))
    parts :+ last
  end topLevelParts

end OrchSpecRegistration

enum RegistrationResult:
  case Unchanged
  case Registered(content: String, added: Seq[String])
  case Manual(reason: String, snippet: String)

object OrchSpecExport:

  private val fileRule    = "// " + "─" * 72
  private val sectionRule = "// " + "═" * 72

  /** Splits the Scala export into its files:
    * {{{
    * // ────────
    * // 01-domain/src/main/scala/.../MyTask.scala  (in die bestehende Datei einfügen)
    * // ────────
    *
    * content
    * }}}
    * Section headers (`// ════════`) only group the files - they are dropped.
    */
  def parse(text: String): Seq[OrchSpecFile] =
    val lines = text.linesIterator.toVector

    def isFileHeader(i: Int)    =
      lines(i) == fileRule && i + 2 < lines.size && lines(i + 2) == fileRule
    def isSectionHeader(i: Int) =
      lines(i) == sectionRule && i + 2 < lines.size && lines(i + 2) == sectionRule

    val headers = lines.indices.filter(isFileHeader)
    headers.zipWithIndex.map: (start, n) =>
      val end     = headers.lift(n + 1).getOrElse(lines.size)
      val header  = lines(start + 1).stripPrefix("// ").trim
      val body    = lines.slice(start + 3, end)
      val content = body.indices
        .find(i => isSectionHeader(start + 3 + i))
        .map(body.take)
        .getOrElse(body)
      // `path  (in die bestehende Datei einfügen)` - the path has no blanks
      val path    = header.takeWhile(!_.isWhitespace)
      OrchSpecFile(
        os.RelPath(path),
        content.mkString("\n").trim + "\n",
        insert = header.drop(path.length).trim.nonEmpty
      )
  end parse

  /** The directory of the process - the classes in `schema/` are one level below. */
  def processDir(files: Seq[OrchSpecFile]): os.RelPath =
    val dirs = files.map: f =>
      val dir = f.path / os.up
      if dir.last == "schema" then dir / os.up else dir
    dirs.distinct match
      case Seq(dir) => dir
      case other    =>
        throw IllegalArgumentException(
          s"The export contains files of more than one process: ${other.mkString(", ")}"
        )
  end processDir

  /** The id of the executable process in the BPMN. */
  def processId(bpmn: String): Option[String] =
    val processes = """<(?:\w+:)?process\s[^>]*>""".r.findAllIn(bpmn).toSeq
    val id        = """\sid="([^"]+)"""".r
    processes
      .sortBy(p => !p.contains("""isExecutable="true""""))
      .flatMap(id.findFirstMatchIn(_).map(_.group(1)))
      .headOption
  end processId

  /** Marks a file that differs as a whole (and not only in parts). */
  val whole = "whole"

  /** `Seq(whole)` if the existing file differs from the export - blanks at the line ends do not count. */
  def differences(existing: String, exported: String): Seq[String] =
    if normalized(existing) == normalized(exported) then Seq.empty else Seq(whole)

  private[update] def normalized(text: String): Seq[String] =
    text.linesIterator.map(_.stripTrailing).toSeq.reverse.dropWhile(_.isEmpty).reverse

  def isC8(bpmn: String): Boolean =
    bpmn.contains("http://camunda.org/schema/zeebe/1.0")

  /** A DMN of the Camunda Modeler for Camunda 8 - `modeler:executionPlatform="Camunda Cloud"`. */
  def isC8Dmn(dmn: String): Boolean =
    dmn.contains("executionPlatform=\"Camunda Cloud\"")

  /** The file name of a DMN table - only the name (no path out of the diagram folder), with `.dmn`. */
  def dmnFileName(file: String): String =
    val name = file.split("[/\\\\]").last.trim
    if name.endsWith(".dmn") then name else s"$name.dmn"

  /** Object name and DSL of an interaction - `MyTask -> CustomTask` for `object MyTask extends CompanyBpmnCustomTaskDsl`. */
  def interaction(content: String): Option[(String, String)] =
    """(?m)^object (\w+) extends CompanyBpmn(\w+)Dsl""".r
      .findFirstMatchIn(content)
      .map(m => m.group(1) -> m.group(2))

  /** The interactions that get a worker: the custom tasks of this process - their topic starts with
    * the process id (`acme-product-orderCard-…`, also `…orderCardV1-…`); one of another project
    * exists there already. A user task, a signal and a message have none - a validation worker was
    * created and registered for each signal and message.
    */
  def workerNames(interactions: Seq[(String, String, Option[String])], processId: String): Seq[String] =
    interactions.collect { case (name, "CustomTask", Some(topic)) if topic.startsWith(processId) => name }

  /** An interaction object of another project: a custom task whose topic does not start with the
    * process id - its domain object and worker exist there (the export of Orch Spec leaves out the
    * others of another package; it knows the catalog).
    */
  def isForeign(content: String, processId: String): Boolean =
    interaction(content).exists((_, dsl) => dsl == "CustomTask") &&
      !topicName(content).exists(_.startsWith(processId))

  /** `val topicName = "…"` of a worker object. */
  def topicName(content: String): Option[String] =
    """(?m)^\s*val topicName\s*=\s*"([^"]*)"""".r.findFirstMatchIn(content).map(_.group(1))

  /** Adds an import after the package clause. */
  def withImport(content: String, importLine: String): String =
    if content.contains(importLine) then content
    else
      val (head, rest) = content.linesIterator.toSeq.span(_.startsWith("package "))
      (head ++ Seq("", importLine) ++ rest.dropWhile(_.isBlank).prepended("")).mkString("\n") + "\n"

end OrchSpecExport

/** The process object from the part of the export that goes into it (`In`, `Out`, `InConfig`,
  * `InitIn`). Orch Spec leaves the rest to the implementation - this adds it:
  *   - `processName`, `descr` and the examples of the process,
  *   - the `inConfig` of `In` (`WithConfig`), so the mocks of `InConfig` can be used,
  *   - empty classes for what the export does not contain.
  */
case class OrchSpecProcessObject(
    pkg: String,
    objectName: String,
    processId: String,
    block: String,
    schemaImport: Option[String] = None
):
  private lazy val blockLines = block.linesIterator.toSeq
  // the export lists the imports as comments: `// import …`
  private lazy val imports    = blockLines.collect:
    case l if l.startsWith("// import ") => l.stripPrefix("// ")
  private lazy val body       = blockLines
    .dropWhile(l => l.isBlank || l.trim.startsWith("//"))

  private def defines(name: String) =
    body.exists(l => l.startsWith(s"  case class $name(") || l.startsWith(s"  enum $name:"))
  private def isEnum(name: String)  = body.exists(_.startsWith(s"  enum $name:"))

  lazy val hasInitIn: Boolean = defines("InitIn")

  /** What the init worker returns in `customInit` - the export puts it as comment before the classes:
    * {{{
    * // im InitWorker (customInit):
    * // InitIn(
    * //   debitAccountForFee = in.debitAccountForFee.getOrElse(90)
    * // )
    * }}}
    * (the optional fields of `In` with a default - in `InitIn` they are required)
    */
  lazy val customInit: Option[String] =
    val start = blockLines.indexWhere(_.trim == "// im InitWorker (customInit):")
    Option.when(start >= 0):
      blockLines.drop(start + 1).takeWhile(_.startsWith("// ")).map(_.stripPrefix("// ")).mkString("\n")
    .filter(_.nonEmpty)

  /** `processLabels` of the process (de, fr) - the export gives them as `// processLabels: de | fr`. */
  lazy val processLabels: Option[(String, String)] =
    blockLines.collectFirst { case l if l.startsWith("// processLabels: ") => l.stripPrefix("// processLabels: ") }
      .flatMap: text =>
        text.split(" \\| ", 2).toSeq match
          case Seq(de, fr) => Some(de.trim -> fr.trim)
          case _           => None

  /** `descr` of the process - the export gives it as `// descr: …` (already escaped), each further
    * line as `// descr| …`.
    */
  lazy val descr: String =
    val start = blockLines.indexWhere(_.startsWith("// descr: "))
    if start < 0 then ""
    else
      val more = blockLines.drop(start + 1).takeWhile(_.startsWith("// descr|"))
        .map(_.stripPrefix("// descr|").stripPrefix(" ").stripTrailing)
      (blockLines(start).stripPrefix("// descr: ").trim +: more).mkString("\n").trim

  /** `lazy val descr` - one line as a String, more lines as `"""…""".stripMargin`. */
  private lazy val descrLines: Seq[String] =
    val lines = descr.linesIterator.toSeq
    if lines.size <= 1 then Seq(s"""  lazy val descr: String = "$descr"""")
    else
      // the export escapes for "…" - in """…""" a quote and a backslash stand as they are
      val raw = lines.map(_.replace("\\\"", "\"").replace("\\\\", "\\"))
      Seq("  lazy val descr: String =", s"""    \"\"\"${raw.head}""") ++
        raw.tail.map(l => s"      |$l") :+ "      |\"\"\".stripMargin"

  /** What differs in an existing process object - only what comes from Orch Spec: the types of
    * the export (`In`, `InitIn`, `InConfig`, `Out` and the other types of the block) and the
    * imports. The rest is implementation.
    */
  def differences(existing: String): Seq[String] =
    val existingLines = existing.linesIterator.toSeq
    val generated     = content.linesIterator.toSeq
    val toMerge       = exportTypes(existingLines)
    val types         = ObjectSections(generated).filter(g => toMerge.contains(g.name))
      .filter(g => mergeType(existingLines, g, generated) != existingLines)
      .map(_.name)
    types ++ Option.when(missingLabels(existingLines))("processLabels") ++
      Option.when(missingImports(existingLines).nonEmpty)("imports")
  end differences

  /** The existing process object with what comes from Orch Spec: each type of the export replaces
    * the one of the same name, a missing one goes in its place (`In`, `InitIn`, `InConfig`, `Out`,
    * then the others), missing imports are added, and `processLabels` if the object has none - the
    * init worker sets `callingProcessKeyDE/FR` from them. Everything else stays as it is - the
    * package clause, the other imports, `descr`, existing `processLabels`, the examples of the
    * process, comments.
    */
  def merge(existing: String): String =
    val generated = content.linesIterator.toSeq
    val lines     = existing.linesIterator.toSeq
    val toMerge   = exportTypes(lines)
    val merged    = ObjectSections(generated).filter(g => toMerge.contains(g.name))
      .foldLeft(lines)(mergeType(_, _, generated))
    withImports(withLabels(merged), missingImports(merged)).mkString("\n") + "\n"
  end merge

  // `InConfig.example` / `Proc.InConfig.exampleMinimal` of this object - not `Other.InConfig.example`
  private lazy val ownInConfigExample =
    s"""(?<![\\w.])(?:${java.util.regex.Pattern.quote(objectName)}\\.)?InConfig\\.example(?:Minimal)?\\b"""

  // `override def`, `override val` or `override lazy val` - each is the object's own processLabels
  private def missingLabels(lines: Seq[String]): Boolean =
    processLabels.isDefined && !lines.exists(_.trim.matches("""override\s+(?:def|val|lazy\s+val)\s+processLabels\b.*"""))

  // after `descr` (`val`, `lazy val`, `override def` - to its end, it can span lines) - otherwise
  // after `val processName`
  private def withLabels(lines: Seq[String]): Seq[String] =
    processLabels.filter(_ => missingLabels(lines)).fold(lines): (de, fr) =>
      val descr = lines.indexWhere(_.trim.matches("""(?:override\s+)?(?:def|val|lazy\s+val)\s+descr\b.*"""))
      val at    = if descr >= 0 then descrEnd(lines, descr) else lines.indexWhere(_.trim.startsWith("val processName"))
      if at < 0 then lines
      else lines.patch(at + 1, Seq("", "  override lazy val processLabels: ProcessLabels =", s"""    ProcessLabels("$de", "$fr")"""), 0)

  // the last line of the `descr` starting at `start`: the value on the next line (`=` at the end),
  // a `"""` text up to its closing `"""`
  private def descrEnd(lines: Seq[String], start: Int): Int =
    val quotes = (i: Int) => "\"\"\"".r.findAllIn(lines(i)).size
    var i      = start
    if lines(i).trim.endsWith("=") && i + 1 < lines.size then i += 1
    if quotes(i) % 2 == 1 then
      i += 1
      while i < lines.size && quotes(i) == 0 do i += 1
    math.min(i, lines.size - 1)

  /** One type of the export into the lines of the process object:
    *   - missing: inserted after the type that comes before it (`typeOrder`),
    *   - `InConfig` / `InitIn`: only the missing fields are added - they come from the flow, and
    *     what is there already (own mocks, examples) is implementation,
    *   - otherwise replaced - unless it differs only in blanks and line breaks.
    */
  private def mergeType(lines: Seq[String], g: ObjectSection, generated: Seq[String]): Seq[String] =
    val replacement = g.lines(generated)
    val sections    = ObjectSections(lines)
    sections.find(_.name == g.name) match
      case Some(e) if Seq("InConfig", "InitIn").contains(g.name) =>
        val own    = e.lines(lines)
        // a field without default must also be in the `example` - otherwise it does not compile
        val added  = CaseClassParams.addMissingToExample(CaseClassParams.addMissing(own, replacement), own, replacement, g.name)
        // the InConfig is the configuration: an own field without default gets the one of Orch Spec
        // (the values were in `InConfig.example` - `defaultConfig = InConfig.example`)
        val merged = if g.name == "InConfig" then CaseClassParams.addDefaults(added, replacement) else added
        // with all values as defaults the InConfig needs no example: `InConfig.example` -> `InConfig()` -
        // only when its examples are those defaults, otherwise the configuration would change
        if g.name == "InConfig" && CaseClassParams.allHaveDefaults(merged) &&
          CaseClassParams.examplesAreDefaults(merged, g.name)
        then
          lines.patch(e.from, TypeImplementation.withoutExamples(merged, g.name), e.until - e.from)
            .map(l => if l.trim.startsWith("//") then l else l.replaceAll(ownInConfigExample, "InConfig()"))
        else lines.patch(e.from, merged, e.until - e.from)
      case Some(e) if compact(e.lines(lines)) == compact(replacement) => lines
      case Some(e) =>
        // the parameters and examples from Orch Spec - the implementation of the class stays
        val merged = TypeImplementation.merge(e.lines(lines), replacement, g.name)
        if compact(e.lines(lines)) == compact(merged) then lines
        else lines.patch(e.from, merged, e.until - e.from)
      case None    =>
        // after the type that comes before it - otherwise before the first type, or before the
        // examples of the process
        val before = typeOrder.takeWhile(_ != g.name).reverse
          .flatMap(n => sections.find(_.name == n)).headOption
        val at     = before.map(_.until)
          .orElse(sections.headOption.map(_.from - 1))
          .getOrElse(lines.indexWhere(l => l.startsWith("  lazy val example") || l.startsWith("end ")))
        if at < 0 then lines
        else if before.isDefined then lines.patch(at, "" +: replacement, 0)
        else lines.patch(at + 1, replacement :+ "", 0)
    end match
  end mergeType

  private def compact(lines: Seq[String]) = lines.mkString.replaceAll("\\s+", "")

  // the types of the generated content in the order of the domain - In, InitIn, InConfig, Out
  private lazy val typeOrder: Seq[String] =
    val names = ObjectSections(content.linesIterator.toSeq).map(_.name)
    OrchSpecProcessObject.order.filter(names.contains) ++ names.filterNot(OrchSpecProcessObject.order.contains)

  // what the export brings - the empty classes for the rest are only for a new file
  private lazy val blockTypes: Seq[String] =
    val inBlock = ObjectSections(body).map(_.name)
    // without its own `In` the export still gives the `inConfig` - so the generated `In` counts
    inBlock ++ Option.when(inBlock.nonEmpty && !inBlock.contains("In"))("In")

  // `InConfig` as a whole word - not `MyInConfig`
  private val inConfigWord = """\bInConfig\b""".r

  /** The types of the export that go into an existing object - and the empty `InConfig` when the
    * `In` brings `WithConfig[InConfig]` into an object that has no `InConfig` yet (otherwise it
    * does not compile). One the object knows already - its own class, an alias, an import, or one
    * the `In` used before (defined elsewhere) - stays as it is. Only the whole word counts (not
    * `MyInConfig`), and not in a line comment or a line that starts a block comment. Not
    * detected: an `InConfig` that only comes in with a wildcard import and that `In` did not use
    * before - the empty `InConfig` then shadows it.
    */
  private def exportTypes(existing: Seq[String]): Seq[String] =
    blockTypes ++ Option.when(
      blockTypes.contains("In") && !blockTypes.contains("InConfig") && inRefersToInConfig &&
        !existing.exists(knowsInConfig)
    )("InConfig")

  // the code of a line (without a trailing `// …`) names `InConfig` - comment lines do not count
  private def knowsInConfig(line: String): Boolean =
    val trimmed   = line.trim
    val isComment = trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")
    val code      = trimmed.indexOf("//") match
      case -1 => trimmed
      case at => trimmed.take(at)
    !isComment && inConfigWord.findFirstIn(code).isDefined

  private lazy val inRefersToInConfig: Boolean =
    val generated = content.linesIterator.toSeq
    ObjectSections(generated).find(_.name == "In")
      .exists(_.lines(generated).exists(inConfigWord.findFirstIn(_).isDefined))

  private def missingImports(lines: Seq[String]): Seq[String] =
    (imports ++ schemaImport).distinct.filterNot(OrchSpecImports.covered(lines, _))

  // after the last import - or after the package clause
  private def withImports(lines: Seq[String], missing: Seq[String]): Seq[String] =
    if missing.isEmpty then lines
    else
      val lastImport = lines.lastIndexWhere(_.startsWith("import "))
      if lastImport >= 0 then lines.patch(lastImport + 1, missing, 0)
      else
        val lastPackage = lines.lastIndexWhere(_.startsWith("package "))
        lines.patch(lastPackage + 1, "" +: missing, 0)

  // an enum without fields (`case a, b`) cannot carry the inConfig
  lazy val warnings: Seq[String] =
    if isEnum("In") && !body.exists(_.matches("    case \\w+\\(")) then
      Seq(
        s"$objectName.In is an enum without fields - it cannot carry the `inConfig` (WithConfig) - the mocks of InConfig will not work."
      )
    else Seq.empty

  // `package acme.product.domain` + `package lilaSet.v2` - everything of the domain package is
  // visible without import, as in the domain files; without `domain` one clause
  private lazy val packageClause: Seq[String] =
    val parts = pkg.split('.').toSeq
    val at    = parts.indexOf("domain")
    if at >= 0 && at < parts.size - 1 then
      Seq(s"package ${parts.take(at + 1).mkString(".")}", s"package ${parts.drop(at + 1).mkString(".")}")
    else Seq(s"package $pkg")

  // no stripMargin - it would also strip the lines of the exported classes
  lazy val content: String =
    val withIn     = if defines("In") then withConfig(body) else body
    val sections   = ObjectSections(withIn)
    val fromBlock  = sections.map(s => s.name -> s.lines(withIn).mkString("\n")).toMap
    val empties    = Seq(
      "In"       -> emptyIn,
      "InitIn"   -> emptyInitIn,
      "InConfig" -> emptyInConfig,
      "Out"      -> emptyClass("Out")
    )
    // In, InitIn, InConfig, Out - then what else is in the object, as in the export
    val types      =
      empties.map((name, empty) => fromBlock.getOrElse(name, empty)) ++
        sections.map(_.name).filterNot(OrchSpecProcessObject.order.contains).map(fromBlock)
    val allImports = (imports ++ schemaImport).distinct
    Seq(
      packageClause :+ "",
      if allImports.isEmpty then Seq.empty else allImports :+ "",
      Seq(
        s"object $objectName extends CompanyBpmnProcessDsl:",
        "",
        s"""  val processName = "$processId""""
      ) ++ descrLines :+ "",
      processLabels.toSeq.flatMap: (de, fr) =>
        Seq(
          "  override lazy val processLabels: ProcessLabels =",
          s"""    ProcessLabels("$de", "$fr")""",
          ""
        ),
      Seq(types.mkString("\n\n"), ""),
      Seq(
        "  lazy val example = process(",
        "    In.example,",
        "    Out.example,",
        "    InitIn.example",
        "  )",
        "",
        "  lazy val exampleMinimal = process(",
        s"    ${minimal("In")},",
        s"    ${minimal("Out")},",
        s"    ${minimal("InitIn")}",
        "  )",
        s"end $objectName",
        ""
      )
    ).flatten.mkString("\n")
  end content

  // the companion of an enum has no exampleMinimal
  private def minimal(name: String) =
    if isEnum(name) then s"$name.example" else s"$name.exampleMinimal"

  // the exception to "no defaults in the domain objects": the inConfig is always initialised with None;
  // its description comes with `WithConfig`
  private def inConfigField(indent: String) =
    s"${indent}inConfig: Option[InConfig] = None"

  private val withConfigEnd =
    """  ) extends WithConfig[InConfig]:
      |    lazy val defaultConfig = InConfig()
      |  end In""".stripMargin

  /** `In` gets the `inConfig` field (default `None` - the examples need not set it) and extends
    * `WithConfig[InConfig]`.
    */
  private def withConfig(lines: Seq[String]): Seq[String] =
    if lines.exists(_.contains("WithConfig")) then lines
    else if isEnum("In") then enumWithConfig(lines)
    else classWithConfig(lines)

  private def classWithConfig(lines: Seq[String]): Seq[String] =
    val start = lines.indexWhere(_.startsWith("  case class In("))
    if start < 0 then lines
    else if lines(start) == "  case class In()" then
      lines.patch(start, Seq("  case class In(", inConfigField("      "), withConfigEnd), 1)
    else
      val end = lines.indexWhere(_ == "  )", start)
      if end < 0 then lines
      else
        lines
          .patch(end, Seq(inConfigField("      "), withConfigEnd), 1)
          .patch(end - 1, Seq(lines(end - 1) + ","), 1)
    end if
  end classWithConfig

  /** An enum with fields (ADT): the enum extends `WithConfig[InConfig]`, each case gets the
    * `inConfig` field - a case without fields too (`case B` -> `case B(inConfig: .. = None)`,
    * `In.B` -> `In.B()`).
    */
  private def enumWithConfig(lines: Seq[String]): Seq[String] =
    val start    = lines.indexWhere(_ == "  enum In:")
    val end      = lines.indexWhere(_ == "  end In", start)
    val bareCase = """    case (\w+)""".r
    if start < 0 || end < 0 || !lines.slice(start, end).exists(_.matches("    case \\w+\\(")) then lines
    else
      val cases   = lines.slice(start + 1, end).foldLeft(Vector.empty[String]):
        case (done, "    )")       =>
          done.init ++ Seq(done.last + ",", inConfigField("        "), "    )")
        case (done, bareCase(name)) =>
          done ++ Seq(s"    case $name(", inConfigField("        "), "    )")
        case (done, line)           => done :+ line
      val bare    = lines.slice(start + 1, end).collect { case bareCase(name) => name }
      val applied = lines.drop(end).map: line =>
        bare.foldLeft(line)((l, name) => l.replaceAll(s"\\bIn\\.$name\\b(?![\\w(])", s"In.$name()"))
      lines.take(start) ++
        Seq("  enum In extends WithConfig[InConfig]:", "    lazy val defaultConfig = InConfig()", "") ++
        cases ++ applied
    end if
  end enumWithConfig

  private def emptyClass(name: String, fields: String = "") =
    s"""  case class $name($fields)
       |
       |  object $name:
       |    given ApiSchema[$name]  = deriveApiSchema
       |    given InOutCodec[$name] = deriveInOutCodec
       |
       |    lazy val example = $name()
       |    lazy val exampleMinimal = example
       |  end $name""".stripMargin

  private lazy val emptyIn =
    s"""  case class In(
       |${inConfigField("      ")}
       |$withConfigEnd
       |
       |  object In:
       |    given ApiSchema[In]  = deriveApiSchema
       |    given InOutCodec[In] = deriveInOutCodec
       |
       |    lazy val example = In()
       |    lazy val exampleMinimal = example
       |  end In""".stripMargin

  private lazy val emptyInConfig =
    """  case class InConfig()
      |
      |  object InConfig:
      |    given ApiSchema[InConfig]  = deriveApiSchema
      |    given InOutCodec[InConfig] = deriveInOutCodec
      |  end InConfig""".stripMargin

  private lazy val emptyInitIn = emptyClass("InitIn")

end OrchSpecProcessObject

object OrchSpecProcessObject:
  /** The order of the types in a process object. */
  val order: Seq[String] = Seq("In", "InitIn", "InConfig", "Out")

/** A type in an object - `case class X(` / `enum X` with its companion up to `end X`, the
  * scaladoc or comment right before it included. `from` / `until` are line indexes.
  */
case class ObjectSection(name: String, from: Int, until: Int):
  def lines(all: Seq[String]): Seq[String] = all.slice(from, until)

object ObjectSections:
  private val start = """  (?:final\s+)?(?:case class|enum)\s+(\w+)\b.*""".r

  /** The types on the first level of an object (indented by two). */
  def apply(lines: Seq[String]): Seq[ObjectSection] =
    lines.indices.collect { case i if start.matches(lines(i)) => i }.map: i =>
      val name = lines(i) match
        case start(n) => n
      // the scaladoc or comment right before - without a blank line in between
      val from = Iterator.iterate(i)(_ - 1).takeWhile(j => j == i || j >= 0 && isDoc(lines(j))).toSeq.last
      // the class, its body and its companion - until the next member of the object
      val end  = Iterator.from(i + 1).takeWhile(j => j < lines.size && belongs(lines(j), name)).toSeq
      val last = (i +: end).filterNot(j => lines(j).isBlank).last
      ObjectSection(name, from, last + 1)
    .toSeq
  end apply

  private def indent(l: String) = l.indexWhere(_ != ' ')

  private def isDoc(l: String) =
    val t = l.trim
    indent(l) >= 2 && (t.startsWith("/**") || t.startsWith("*") || t.startsWith("//"))

  private def belongs(l: String, name: String) =
    l.isBlank || indent(l) > 2 || l.startsWith("  )") ||
      l == s"  end $name" || l.startsWith(s"  object $name:") || l == s"  object $name"
end ObjectSections

/** The parameters of a `case class X(` - each with the annotations and comments before it. */
object CaseClassParams:

  /** The section with the parameters of `generated` it does not have yet - appended to its own. */
  def addMissing(section: Seq[String], generated: Seq[String]): Seq[String] =
    val own     = params(section)
    val missing = params(generated).filterNot(p => own.exists(_.name == p.name))
    if missing.isEmpty then section
    else
      val start = section.indexWhere(_.matches("""\s*(?:final\s+)?case class \w+\(.*"""))
      val close = closing(section, start)
      if start < 0 then section
      else if close < 0 then
        // `case class InConfig()` - on one line
        val head = section(start).replaceFirst("""\(\)(.*)$""", "(")
        val tail = section(start).replaceFirst("""^.*\(\)""", "  )")
        section.patch(start, (head +: withCommas(missing.map(_.lines))) :+ tail, 1)
      else
        val last    = (start + 1 until close).filter(j => isCode(section(j))).lastOption
        val withEnd = last match
          case Some(j) if !section(j).trim.endsWith(",") => section.updated(j, section(j) + ",")
          case _                                         => section
        withEnd.patch(close, withCommas(missing.map(_.lines)), 0)
      end if
  end addMissing

  /** The own parameters without default get the default `generated` has for them (on the line of
    * the parameter: `timer: String,` -> `timer: String = "P1D",`). The rest stays as it is.
    */
  def addDefaults(section: Seq[String], generated: Seq[String]): Seq[String] =
    val start    = section.indexWhere(_.matches("""\s*(?:final\s+)?case class \w+\(.*"""))
    val close    = closing(section, start)
    // only a default on one line - the line of the parameter, complete, without comment
    val defaults = params(generated).filter(hasDefault).flatMap: p =>
      val code = p.lines.dropWhile(l => !l.matches("""\s*\w+\s*:.*""")).filter(isCode)
      code match
        case Seq(withDefault(_, d)) if balance(d) == 0 && !d.contains("//") => Some(p.name -> d)
        case _                                                            => None
    if start < 0 || close < 0 then section
    else
      params(section).filterNot(hasDefault).foldLeft(section): (lines, p) =>
        // the own parameter on one line too - its type complete, no comment to put the default into
        val at = (start + 1 until close).find(j => lines(j).matches(s"""\\s*${p.name}\\s*:.*"""))
          .filter(j => balance(lines(j)) == 0 && !lines(j).contains("//"))
        (at, defaults.find(_._1 == p.name)) match
          case (Some(j), Some((_, d))) =>
            val line  = lines(j).replaceAll("""\s+$""", "")
            val comma = line.endsWith(",")
            lines.updated(j, s"${line.stripSuffix(",")} = $d${if comma then "," else ""}")
          case _                       => lines
  end addDefaults

  // `name: Type = value` on one line - the value without the comma; `=>` in the type is no `=`
  private val withDefault = """\s*(\w+)\s*:(?:[^=]|=>)*?\s=(?!>)\s*(.+?),?\s*""".r

  /** Every parameter has a default - `X()` is a valid value. */
  def allHaveDefaults(section: Seq[String]): Boolean =
    val ps = params(section)
    ps.nonEmpty && ps.forall(hasDefault)

  /** `example` sets no value other than the defaults (`X()`, or each argument its default) and
    * `exampleMinimal` is none, `example`, `example.copy()` or `X()` - then `X()` is the same.
    */
  def examplesAreDefaults(section: Seq[String], name: String): Boolean =
    val compact  = (s: String) => s.replaceAll("\\s+", "").stripSuffix(",")
    val defaults = params(section).flatMap: p =>
      p.lines.dropWhile(l => !l.matches("""\s*\w+\s*:.*""")).filter(isCode).mkString(" ") match
        case defaultValue(d) => Some(p.name -> compact(d))
        case _               => None
    .toMap
    val args     = exampleArgs(section, name).map: a =>
      a.name -> compact(a.lines.filter(isCode).mkString(" ").replaceFirst("""^\s*\w+\s*=""", ""))
    val example  = exampleStart(section, name) < 0 ||
      section(exampleStart(section, name)).trim.endsWith(s"$name()") ||
      (args.nonEmpty && args.forall((n, v) => defaults.get(n).contains(v)))
    val minimal  = section.find(_.matches("""\s*lazy val exampleMinimal\s*=.*""")).forall: l =>
      Seq("example", "example.copy()", s"$name()").contains(compact(l.replaceFirst(""".*?=""", "")))
    example && minimal

  // the default of a parameter (its code on one line): `name: Type = value`
  private val defaultValue = """(?s)\s*\w+\s*:(?:[^=]|=>)*?\s=(?!>)\s*(.+?),?\s*""".r

  /** The fields that `generated` adds to `own` and that have no default - with their argument in
    * the `lazy val example = X(…)` of `generated` added to the example of `section` (a field with
    * a default is fine without). Without an example in `section` or `generated` nothing changes.
    */
  def addMissingToExample(section: Seq[String], own: Seq[String], generated: Seq[String], name: String): Seq[String] =
    val ownNames = params(own).map(_.name).toSet
    val required = params(generated).filterNot(p => ownNames.contains(p.name)).filterNot(hasDefault).map(_.name)
    val genArgs  = exampleArgs(generated, name)
    val toAdd    = required.flatMap(n => genArgs.find(_.name == n))
    val start    = exampleStart(section, name)
    if toAdd.isEmpty || start < 0 then section
    else if section(start).trim.endsWith(s"$name()") then
      // `lazy val example = InitIn()` - on one line
      val indent = section(start).takeWhile(_ == ' ')
      section.patch(
        start,
        (section(start).stripSuffix("()") + "(") +: withCommas(toAdd.map(_.lines)) :+ s"$indent)",
        1
      )
    else
      val close = closing(section, start)
      if close < 0 then section
      else
        val args    = exampleArgs(section, name)
        val last    = (start + 1 until close).filter(j => isCode(section(j))).lastOption
        val withEnd = last match
          case Some(j) if args.nonEmpty && !section(j).trim.endsWith(",") => section.updated(j, section(j) + ",")
          case _                                                         => section
        withEnd.patch(close, withCommas(toAdd.map(_.lines)), 0)
    end if
  end addMissingToExample

  private def exampleStart(section: Seq[String], name: String): Int =
    section.indexWhere(_.matches(s"""\\s*lazy val example\\s*=\\s*$name\\(.*"""))

  /** The named arguments of `lazy val example = X(…)` - each with its lines. */
  private def exampleArgs(section: Seq[String], name: String): Seq[Param] =
    val start = exampleStart(section, name)
    val close = if start < 0 || section(start).trim.endsWith(s"$name()") then -1 else closing(section, start)
    if close < 0 then Seq.empty
    else
      split(section.slice(start + 1, close)).flatMap: ls =>
        ls.collectFirst { case l if l.matches("""\s*\w+\s*=.*""") => l.trim.takeWhile(c => c.isLetterOrDigit || c == '_') }
          .map(Param(_, withoutComma(ls.reverse.dropWhile(_.isBlank).reverse)))

  // from the line with the name on - the annotations before it (`@description("a = b")`) do not count
  private def hasDefault(p: Param): Boolean =
    p.lines.dropWhile(l => !l.matches("""\s*\w+\s*:.*""")).filter(isCode).mkString(" ")
      .matches("""(?s)\s*\w+\s*:(?:[^=]|=>)*=(?!>).*""")

  case class Param(name: String, lines: Seq[String])

  /** The parameters between `case class X(` and its closing `)`. */
  def params(section: Seq[String]): Seq[Param] =
    val start = section.indexWhere(_.matches("""\s*(?:final\s+)?case class \w+\(.*"""))
    val close = closing(section, start)
    if start < 0 || close < 0 then Seq.empty
    else
      split(section.slice(start + 1, close)).flatMap: ls =>
        ls.collectFirst { case l if l.matches("""\s*\w+\s*:.*""") => l.trim.takeWhile(c => c.isLetterOrDigit || c == '_') }
          .map(Param(_, withoutComma(ls.reverse.dropWhile(_.isBlank).reverse)))
  end params

  // a parameter (an argument) ends with the comma at depth 0 - its annotations and comments come before it
  private def split(lines: Seq[String]): Seq[Seq[String]] =
    lines.foldLeft((Vector.empty[Seq[String]], Vector.empty[String], 0)):
      case ((done, current, depth), line) =>
        val d = depth + balance(line)
        // `timer: String, // the timer` - the comma before a comment at the end counts too
        val code = line.replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "\"\"").replaceFirst("""\s*//.*$""", "")
        if d == 0 && isCode(line) && code.trim.endsWith(",") then (done :+ (current :+ line), Vector.empty, d)
        else (done, current :+ line, d)
    match
      case (done, rest, _) => done ++ Option.when(rest.exists(isCode))(rest)

  // the comma after the parameter - on its last line of code
  private def withoutComma(ls: Seq[String]): Seq[String] =
    val last = ls.lastIndexWhere(isCode)
    if last < 0 then ls else ls.updated(last, ls(last).stripSuffix(","))

  // the line with the `)` that closes the parameter list - on the same indentation as the start
  private[update] def closing(section: Seq[String], start: Int): Int =
    if start < 0 || section(start).matches("""\s*(?:final\s+)?case class \w+\(\).*""") then -1
    else
      val indent = section(start).indexWhere(_ != ' ')
      section.indexWhere(l => l.indexWhere(_ != ' ') == indent && l.trim.startsWith(")"), start + 1)

  private def withCommas(params: Seq[Seq[String]]): Seq[String] =
    params.zipWithIndex.flatMap: (ls, i) =>
      if i == params.size - 1 then ls else ls.init :+ (ls.last + ",")

  private[update] def isCode(l: String) = !l.isBlank && !l.trim.startsWith("//")

  // parentheses and brackets outside of strings
  private def balance(l: String): Int =
    l.replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "").takeWhile(_ => true).split("//").head
      .foldLeft(0)((d, c) => if "([".contains(c) then d + 1 else if ")]".contains(c) then d - 1 else d)
end CaseClassParams

/** The implementation of a case class in an existing process object - the body of the class (after
  * its parameters: `lazy val defaultConfig`, own `def`s) and its companion (type aliases, own
  * givens and codecs). Orch Spec knows neither: from it come the parameters with the `extends`
  * and the examples (`example`, `exampleMinimal`). A member Orch Spec needs and the existing code
  * does not have (`defaultConfig` for `WithConfig`, the givens) is added.
  */
object TypeImplementation:
  import CaseClassParams.{closing, isCode}

  private case class Parts(head: Seq[String], body: Seq[String], companion: Seq[String])


  def merge(own: Seq[String], generated: Seq[String], name: String): Seq[String] =
    (parts(own, name), parts(generated, name)) match
      case (Some(o), Some(g)) =>
        val body      = if o.body.exists(isCode) then withMembers(o.body, g.body) else g.body
        // a body needs the colon after the parameters - Orch Spec writes one only with `extends`
        val head      =
          if body.exists(l => isCode(l) && !l.trim.startsWith("end ")) && !g.head.last.trim.endsWith(":")
          then g.head.init :+ (g.head.last + ":")
          else g.head
        val companion =
          if o.companion.exists(isCode) then withExamples(withMembers(o.companion, g.companion), g.companion, name)
          else g.companion
        head ++ body ++ companion
      case _                  => generated

  /** The section without `example` / `exampleMinimal` in its companion - and without the blank
    * lines they leave behind.
    */
  def withoutExamples(section: Seq[String], name: String): Seq[String] =
    parts(section, name) match
      case Some(p) if p.companion.nonEmpty =>
        val companion = examples.foldLeft(p.companion): (ls, ex) =>
          block(ls, ex).fold(ls)((from, to) => ls.patch(from, Nil, to - from))
        val tidy      = companion.zipWithIndex.filterNot: (l, i) =>
          l.isBlank && (i + 1 >= companion.size || companion(i + 1).isBlank || companion(i + 1).trim == s"end $name")
        p.head ++ p.body ++ tidy.map(_._1)
      case _                               => section

  /** The class up to the end of its parameters, its body, its companion `object X`. */
  private def parts(section: Seq[String], name: String): Option[Parts] =
    val start = section.indexWhere(_.matches(s"""\\s*(?:final\\s+)?case class $name\\b.*"""))
    if start < 0 then enumParts(section, name)
    else
      val close   = closing(section, start)
      val headEnd = (if close < 0 then start else close) + 1
      val obj     = section.indexWhere(_.matches(s"""\\s*object $name\\b.*"""), headEnd)
      val until   = if obj < 0 then section.size else obj
      Some(Parts(section.take(headEnd), section.slice(headEnd, until), if obj < 0 then Seq.empty else section.drop(obj)))

  /** An `enum X` (ADT): the head up to its `end X` - its cases come from Orch Spec - and its
    * companion `object X`, which keeps the own codecs and decoders like the one of a class.
    */
  private def enumParts(section: Seq[String], name: String): Option[Parts] =
    val start = section.indexWhere(_.matches(s"""\\s*enum $name\\b.*"""))
    if start < 0 then None
    else
      val end     = section.indexWhere(l => l.trim == s"end $name" && indentOf(l) == indentOf(section(start)), start + 1)
      val obj     = section.indexWhere(_.matches(s"""\\s*object $name\\b.*"""), start + 1)
      val headEnd =
        if end >= 0 && (obj < 0 || end < obj) then end + 1
        else if obj >= 0 then obj
        else section.size
      val until   = if obj < 0 then section.size else obj
      Some(Parts(section.take(headEnd), section.slice(headEnd, until), if obj < 0 then Seq.empty else section.drop(obj)))

  // a member: `val`, `lazy val`, `def` by its name - a `given` by its type (`given x: InOutCodec[In]`
  // and `given InOutCodec[In]` are the same)
  private val member =
    """\s*(?:(?:override|private|protected|final|implicit)\s+)*(?:lazy\s+val|val|def)\s+(\w+).*""".r
  private val givenMember =
    """\s*given\s+(?:\w+\s*:\s*)?([^=]+?)\s*=.*""".r

  private def keyOf(l: String): Option[String] = l match
    case givenMember(t) => Some(s"given ${t.replaceAll("\\s+", "")}")
    case member(n)      => Some(n)
    case _              => None

  private def indentOf(l: String) = l.indexWhere(_ != ' ')

  // a generated `given T` the own lines have in another form - `implicit val x: T = …`,
  // `given T with …`, `given x(using …): T = …`: a second one would make it ambiguous
  private def implicitFor(own: Seq[String], key: String): Boolean =
    key.startsWith("given ") && {
      val tpe = key.stripPrefix("given ")
      own.exists(l => """^\s*(?:(?:private|protected|override)\s+)*(?:given|implicit)\b.*""".r.matches(l) &&
        l.replaceAll("\\s+", "").contains(tpe))
    }

  // the indent of the members: the first code line (after `object X:` in a companion)
  private def memberIndent(lines: Seq[String]): Int =
    lines.filter(isCode).dropWhile(_.trim.startsWith("object ")).headOption.map(indentOf).getOrElse(-1)

  // the members on the member level, each with its lines (see `extent`)
  private def members(lines: Seq[String]): Seq[(String, Seq[String])] =
    val at = memberIndent(lines)
    lines.indices.flatMap: i =>
      if isCode(lines(i)) && indentOf(lines(i)) == at then keyOf(lines(i)).map(_ -> lines.slice(i, extent(lines, i)))
      else None

  // the members of `generated` the own lines lack, with all their lines - after the first line
  // (`object X:`) of a companion, at the start of a body
  private def withMembers(own: Seq[String], generated: Seq[String]): Seq[String] =
    val keys    = members(own).map(_._1).toSet
    val missing = members(generated).collect:
      case (k, ls) if !keys.contains(k) && !examples.contains(k) && !implicitFor(own, k) => ls
    .flatten
    if missing.isEmpty then own
    else if own.headOption.exists(_.trim.startsWith("object ")) then own.head +: (missing ++ own.tail)
    else missing ++ own

  private val examples = Seq("example", "exampleMinimal")

  // `lazy val example` / `exampleMinimal` of `generated` replace the own ones - missing ones go
  // before `end X`
  private def withExamples(own: Seq[String], generated: Seq[String], name: String): Seq[String] =
    examples.foldLeft(own): (lines, ex) =>
      block(generated, ex) match
        case None               => lines
        case Some((gFrom, gTo)) =>
          val replacement = generated.slice(gFrom, gTo)
          block(lines, ex) match
            case Some((from, to)) => lines.patch(from, replacement, to - from)
            case None             =>
              val end = lines.lastIndexWhere(_.trim == s"end $name")
              if end < 0 then lines ++ replacement else lines.patch(end, replacement, 0)

  // the lines of `lazy val <name> = …`: the start and what is indented deeper, the closing `)`
  private def block(lines: Seq[String], name: String): Option[(Int, Int)] =
    // also `val example`, `def example`, `override lazy val example`, `lazy val example: In` - on the member level only
    val at    = memberIndent(lines)
    val start = lines.indexWhere(l =>
      indentOf(l) == at &&
        l.matches(s"""\\s*(?:(?:override|final|private|protected)\\s+)*(?:(?:lazy\\s+)?val|def)\\s+$name\\b.*""")
    )
    Option.when(start >= 0)(start -> extent(lines, start))

  // the end (exclusive) of the member starting at `start`: the lines indented deeper and its
  // closing `)` - a blank line inside too, when the next code line still belongs to it
  private def extent(lines: Seq[String], start: Int): Int =
    val indent  = indentOf(lines(start))
    def belongs(j: Int) = indentOf(lines(j)) > indent || lines(j).trim.startsWith(")")
    val next    = Iterator.from(start + 1).takeWhile(_ < lines.size)
    val inside  = next.takeWhile: j =>
      if lines(j).isBlank then Some(lines.indexWhere(!_.isBlank, j)).filter(_ >= 0).exists(belongs) else belongs(j)
    inside.toSeq.lastOption.getOrElse(start) + 1
end TypeImplementation

/** The imports a file already has - an import is not added again, nor one for a name that is
  * already imported (from somewhere else - that one wins) or visible through the package clause.
  */
object OrchSpecImports:
  private val Import = """import\s+([\w.]+)\.(\{[^}]*\}|\*|_|\w+)(?:\s+as\s+\w+)?\s*(?://.*)?""".r

  def covered(lines: Seq[String], importLine: String): Boolean =
    importLine.trim match
      case Import(prefix, selector) =>
        val packages = visiblePackages(lines)
        val existing = lines.map(_.trim).collect { case Import(p, sel) => (p, names(sel)) }
          .flatMap((p, ns) => (p +: packages.map(pkg => s"$pkg.$p")).map(_ -> ns))
        val wanted   = names(selector)
        packages.contains(prefix) && !wanted.contains("*") ||
        wanted.forall: n =>
          existing.exists((p, ns) => (p == prefix && (ns.contains(n) || ns.contains("*"))) || (n != "*" && ns.contains(n)))
      case _                        => lines.exists(_.trim == importLine.trim)

  private def names(selector: String): Seq[String] =
    selector.stripPrefix("{").stripSuffix("}").split(",").toSeq.map(_.trim.split("\\s+").head)
      .map(n => if n == "_" then "*" else n).filter(_.nonEmpty)

  // `package acme.product` + `package domain.orderCard.v1` - both are visible without import
  private def visiblePackages(lines: Seq[String]): Seq[String] =
    lines.takeWhile(l => !l.startsWith("object ") && !l.startsWith("import "))
      .collect { case l if l.startsWith("package ") => l.stripPrefix("package ").trim }
      .scanLeft("")((acc, p) => if acc.isEmpty then p else s"$acc.$p").drop(1)
end OrchSpecImports

object OrchSpecGenerator:
  /** Where a diagram goes: a C8 export to the C8 path, any other to the project's own engine (C7
    * or Op) - an export of the other engine than the project's falls back to that engine's default.
    */
  def processTypeOf(projectType: BpmnProcessType, c8: Boolean): BpmnProcessType =
    if c8 then
      projectType match
        case c8: BpmnProcessType.C8 => c8
        case _                      => BpmnProcessType.C8()
    else
      projectType match
        case _: BpmnProcessType.C8 => BpmnProcessType.C7()
        case other                 => other
end OrchSpecGenerator
