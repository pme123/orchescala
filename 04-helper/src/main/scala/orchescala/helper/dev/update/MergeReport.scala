package orchescala.helper.dev.update

import orchescala.helper.dev.update.merge.*

/** The output of the merge from Orch Spec in the console - the library itself prints nothing.
  *
  * Laid out like the result of a simulation: a START line, every file that changes with its
  * changes as `git diff` shows them (the code's lines red, Orch Spec's green, a change of the form
  * grey), then the summary - the files grouped by what happens to them - and an END line with the
  * numbers.
  */
object MergeReport:

  private def colored(color: String, text: String) = s"$color$text${Console.RESET}"

  /** grey - `Console` has none */
  private val Grey = "\u001b[90m"

  private val maxLine = 85

  private def banner(color: String, text: String): String =
    val line = "~" * math.max(3, (maxLine - 2 - text.length) / 2)
    colored(color, s"$line $text $line")

  /** The plan before the merge (`--check`, `--merge` before its question): per file what will
    * happen with its changes against the code, then the summary.
    */
  def printPlan(plan: MergePlan, project: os.Path): Unit =
    println(banner(Console.CYAN, s"START Merge plan for ${plan.project}"))
    plan.files.foreach: f =>
      // read only where its changes are shown
      lazy val code = read(project, f.path)
      header(f, planned = true).foreach(println)
      if Seq(Action.merged, Action.update).contains(f.action) then
        if f.binary then println(colored(Grey, "    a binary file - its changes are not shown"))
        else changes(code.getOrElse(""), f.content.getOrElse("")).foreach(println)
      conflictLines(f).foreach(println)
      f.removal.foreach: r =>
        println(colored(Console.YELLOW, s"ONLY IN THE CODE - you are asked: ${what(f, r)}"))
        // what goes - against what is written otherwise
        for c <- r.content; before <- f.content.orElse(code) do changes(before, c).foreach(println)
    printNotes(plan)
    printSummary(plan, None, planned = true)

  /** The texts of the files before the merge - for their changes in `printMerged`. */
  def before(project: os.Path, plan: MergePlan): Map[String, String] =
    plan.files.filter(f => !f.binary && (f.action != Action.unchanged || f.removal.nonEmpty))
      .flatMap(f => read(project, f.path).map(f.path -> _)).toMap

  /** What the merge did - in the words `processFromSpec` always used.
    * @param before the files before the merge (`before`) - their changes are shown; None: only
    *               the summary (the plan with its changes was printed before)
    */
  def printMerged(
      plan: MergePlan,
      result: MergeResult,
      project: os.Path,
      before: Option[Map[String, String]] = None,
      markers: Boolean = false
  ): Unit =
    println(banner(Console.CYAN, s"START Merge from Orch Spec - ${plan.project}"))
    before.foreach: old =>
      plan.files.foreach: f =>
        header(f, planned = false, Some(result), markers).foreach(println)
        if result.written.contains(f.path) && f.action != Action.create then
          if f.binary then println(colored(Grey, "    a binary file - its changes are not shown"))
          else changes(old.getOrElse(f.path, ""), read(project, f.path).getOrElse("")).foreach(println)
        conflictLines(f).foreach(println)
    printNotes(plan)
    printSummary(plan, Some(result), planned = false, markers)
  end printMerged

  /** The merge stopped at a file - what it did before, so the project is not left half merged
    * without a word.
    */
  def printIncomplete(e: MergeIncomplete): Unit =
    println(colored(Console.RED, s"The merge stopped at ${e.failed}: ${MergeIncomplete.reason(e.cause)}"))
    e.done.written.foreach(p => println(colored(Console.GREEN, s"WRITTEN before: $p")))
    e.done.deleted.foreach(p => println(colored(Console.BLUE, s"DELETED before: $p")))
    println(colored(Console.YELLOW, "The other files were not touched - fix the cause and run --merge again (git status shows what changed)."))

  def summary(plan: MergePlan): String =
    Action.values.map(a => s"${plan.summary(a)} $a").mkString("Summary: ", " · ", "")

  /** What only the code has and Orch Spec does not know - before the question whether it goes. */
  def printRemovals(plan: MergePlan): Unit =
    if plan.removals.nonEmpty then
      println(colored(Console.YELLOW, "Only in the code - Orch Spec does not know it (any more):"))
      plan.removals.foreach: f =>
        val r = f.removal.get
        println(colored(Console.YELLOW, s"  ${what(f, r)}"))

  /** Ask whether what only the code has goes - `ask` gets the question, the answer is yes or no.
    * The files and what goes of them are listed before (`printPlan`); the question names them again.
    */
  def askRemoval(plan: MergePlan, ask: String => Option[String] = readAnswer): Boolean =
    plan.removals.nonEmpty && {
      val removals = plan.removals.flatMap(f => f.removal.map(f -> _))
      val n        = removals.map(_._2.names.size).sum
      val whole    = removals.count(_._2.content.isEmpty)
      val files    = removals.map((f, r) => s"  ${what(f, r)}").mkString("\n")
      val asWhole  = if whole == 0 then "" else s", $whole of the ${removals.size} file(s) as a whole"
      isYes(ask(s"\n$files\nDelete these $n class(es), object(s) and case(s) only the code has$asWhole? [y/N] "))
    }

  /** The question on the console - its answer; None at the end of the input (no console, a closed
    * stdin): that is a no.
    */
  def readAnswer(question: String): Option[String] =
    print(question)
    Option(scala.io.StdIn.readLine())

  /** `y`, `yes`, `j`, `ja` - anything else, and no answer, is a no. */
  def isYes(answer: Option[String]): Boolean =
    answer.exists(a => Seq("y", "yes", "j", "ja").contains(a.trim.toLowerCase))

  // ── the files ─────────────────────────────────────────────────────────────────────────

  private def read(project: os.Path, path: String): Option[String] =
    val file = project / os.RelPath(path)
    Option.when(os.isFile(file))(os.read(file))

  private def removed(f: PlannedFile, result: Option[MergeResult]) =
    result.exists(r => f.removal.exists(_.names.forall(r.removed.contains)))

  private def what(f: PlannedFile, r: Removal) =
    if r.content.isEmpty then s"the file ${f.path} (${r.names.mkString(", ")})" else s"${r.names.mkString(", ")} in ${f.path}"

  // the line of a file that changes - None for one that stays as it is
  private def header(f: PlannedFile, planned: Boolean, result: Option[MergeResult] = None, markers: Boolean = false): Option[String] =
    val note = f.note.fold("")(n => s" ($n)")
    f.action match
      case Action.create                          => Some(colored(Console.BLUE, s" - NEW: ${f.path}"))
      case Action.update                          => Some(colored(Console.GREEN, s"UPDATED from Orch Spec: ${f.path}$note"))
      case Action.merged                          => Some(colored(Console.GREEN, s"MERGED with Orch Spec: ${f.path}$note"))
      case Action.delete                          => Some(colored(Console.BLUE, s" - DELETED: ${f.path}"))
      case Action.conflict                        =>
        val todo =
          if planned then "to merge by hand"
          else if markers && f.content.isDefined then "conflict markers written - resolve them in the IDE"
          else "merge it manually, or delete it and run again"
        Some(colored(Console.YELLOW, s"DIFFERS from Orch Spec: ${f.path}$note - $todo."))
      case Action.unchanged if removed(f, result) =>
        Some(colored(Console.BLUE, s" - REMOVED: ${what(f, f.removal.get)}"))
      case Action.unchanged                       => None

  /** The changes of a file as `git diff` shows them: each with the line of the code and two lines
    * around it - the code's lines red, the new ones green, a change of the form grey.
    */
  private[update] def changes(code: String, neu: String, context: Int = 2): Seq[String] =
    import ThreeWay.DiffLine
    // the line of the code each entry is at - a new line at the one of the code it comes before
    val diff     = ThreeWay.diff(code, neu)
    // the lines of the code up to each entry - a new one is not one of them
    val ofCode   = diff.scanLeft(0)((n, d) => if d.isInstanceOf[DiffLine.Spec] then n else n + 1).tail
    val numbered = diff.zip(ofCode).map:
      case (d: DiffLine.Spec, n) => (n + 1, d)
      case (d, n)                => (n, d)
    val changed  = numbered.indices.filterNot(i => numbered(i)._2.isInstanceOf[DiffLine.Same])
    // near changes in one block
    val blocks   = changed.foldLeft(List.empty[(Int, Int)]): (acc, i) =>
      acc match
        case (from, to) :: rest if i - to <= 2 * context + 1 => (from, i) :: rest
        case _                                                => (i, i) :: acc
    blocks.reverse.flatMap: (from, to) =>
      val shown = numbered.slice(math.max(0, from - context), math.min(numbered.size, to + context + 1))
      colored(Grey, s"    line ${numbered(from)._1}:") +: shown.map((_, d) => line(d))

  private def line(d: ThreeWay.DiffLine): String =
    import ThreeWay.DiffLine
    d match
      case DiffLine.Same(l) => s"      $l"
      case DiffLine.Form(l) => colored(Grey, s"    ~ $l")
      case DiffLine.Code(l) => colored(Console.RED, s"    - $l")
      case DiffLine.Spec(l) => colored(Console.GREEN, s"    + $l")

  // the conflicts with their lines - a registration to add by hand as its snippet
  private def conflictLines(f: PlannedFile): Seq[String] =
    f.conflicts.flatMap: c =>
      if c.line == 0 then Seq(s"    add by hand:", c.spec.linesIterator.map(l => s"      $l").mkString("\n"))
      else s"    line ${c.line} ${colored(Console.RED, "- code")} ${colored(Console.GREEN, "+ orch-spec")} ${colored(Grey, "~ only the form")}:" +: diffLines(c)

  /** The lines of a conflict as `git diff` shows them: the code's red, the spec's green, a
    * change of the form (indentation) grey.
    */
  private[update] def diffLines(c: Conflict): Seq[String] =
    ThreeWay.diff(c.code, c.spec).map(line)

  // ── the summary ───────────────────────────────────────────────────────────────────────

  /** The files grouped by what happens to them - like the scenarios of a simulation by their level. */
  private def printSummary(plan: MergePlan, result: Option[MergeResult], planned: Boolean, markers: Boolean = false): Unit =
    def group(color: String, title: String, entries: Seq[String]): Unit =
      if entries.nonEmpty then
        println(colored(color, s"$title (${entries.size}):"))
        entries.foreach(e => println(s"- $e"))
    def withNote(f: PlannedFile) = s"${f.path}${f.note.fold("")(n => s" ($n)")}"
    def of(a: Action)            = plan.withAction(a)
    val (gone, kept)             = plan.removals.partition(removed(_, result))
    val unchanged                = of(Action.unchanged).filter(_.removal.isEmpty)
    println("-" * maxLine)
    group(Console.BLUE, if planned then "To create" else "Created", of(Action.create).map(_.path))
    group(Console.GREEN, if planned then "To update" else "Updated", of(Action.update).map(withNote))
    group(Console.GREEN, if planned then "To merge" else "Merged", of(Action.merged).map(withNote))
    group(Console.BLUE, if planned then "To delete" else "Deleted", of(Action.delete).map(_.path))
    group(
      Console.YELLOW,
      if !planned && markers then "Conflicts - markers written" else "Conflicts - to merge by hand",
      of(Action.conflict).map(withNote)
    )
    group(Console.BLUE, "Removed - only in the code", gone.map(f => what(f, f.removal.get)))
    group(Console.YELLOW, if planned then "Only in the code - you are asked" else "Only in the code - kept", kept.map(f => what(f, f.removal.get)))
    group(Console.RESET, "Unchanged", unchanged.map(withNote))
    val count = Seq(
      "created"                            -> of(Action.create).size,
      "updated"                            -> of(Action.update).size,
      "merged"                             -> of(Action.merged).size,
      "deleted"                            -> of(Action.delete).size,
      "removed"                            -> gone.size,
      "conflicts"                          -> of(Action.conflict).size,
      (if planned then "asked" else "kept") -> kept.size,
      "unchanged"                          -> unchanged.size
    ).filter(_._2 > 0).map((w, n) => s"$n $w")
    val open  = of(Action.conflict).nonEmpty || (!planned && kept.nonEmpty)
    val title = if planned then s"END Merge plan for ${plan.project}" else s"END Merge from Orch Spec - ${plan.project}"
    println(banner(if open then Console.YELLOW else Console.GREEN, s"$title: ${if count.isEmpty then "nothing" else count.mkString(" · ")}"))
  end printSummary

  private def printNotes(plan: MergePlan): Unit =
    plan.notes.foreach(n => println(colored(Console.YELLOW, n)))

end MergeReport
