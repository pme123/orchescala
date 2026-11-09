package orchescala.helper.dev.update

import orchescala.helper.dev.update.merge.*

/** The output of the merge from Orch Spec in the console - the library itself prints nothing. */
object MergeReport:

  private def colored(color: String, text: String) = s"$color$text${Console.RESET}"

  /** The plan before the merge (`--check`): per file what will happen, then the summary. */
  def printPlan(plan: MergePlan): Unit =
    println(s"Merge plan for ${plan.project}:")
    plan.files.filterNot(f => f.action == Action.unchanged && f.removal.isEmpty).foreach: f =>
      if f.action != Action.unchanged then println(planLine(f))
      conflictLines(f).foreach(println)
    printRemovals(plan)
    printNotes(plan)
    println(summary(plan))

  /** What the merge did - in the words `processFromSpec` always used. */
  def printMerged(plan: MergePlan, result: MergeResult, markers: Boolean = false): Unit =
    plan.files.foreach: f =>
      f.action match
        case Action.create    => println(colored(Console.BLUE, s" - NEW: ${f.path}"))
        case Action.update    => println(colored(Console.GREEN, s"UPDATED from Orch Spec: ${f.path}"))
        case Action.merged    => println(colored(Console.GREEN, s"MERGED with Orch Spec: ${f.path}"))
        case Action.delete    => println(colored(Console.BLUE, s" - DELETED: ${f.path}"))
        case Action.unchanged if result.deleted.contains(f.path) => ()
        case Action.unchanged => println(s"UNCHANGED: ${f.path}${f.note.fold("")(n => s" ($n)")}")
        case Action.conflict  =>
          val what =
            if markers && f.content.isDefined then "conflict markers written - resolve them in the IDE"
            else "merge it manually, or delete it and run again"
          println(colored(Console.YELLOW, s"DIFFERS from Orch Spec: ${f.path}${f.note.fold("")(n => s" ($n)")} - $what."))
          conflictLines(f).foreach(println)
    plan.removals.foreach: f =>
      val names = f.removal.toSeq.flatMap(_.names).mkString(", ")
      if f.removal.exists(_.names.forall(result.removed.contains)) then
        println(colored(Console.BLUE, s" - REMOVED: ${f.path}${if result.deleted.contains(f.path) then "" else s" - $names"}"))
      else println(colored(Console.YELLOW, s"ONLY IN THE CODE (kept): ${f.path} - $names"))
    printNotes(plan)
    println(summary(plan))
  end printMerged

  /** What only the code has and Orch Spec does not know - before the question whether it goes. */
  def printRemovals(plan: MergePlan): Unit =
    if plan.removals.nonEmpty then
      println(colored(Console.YELLOW, "Only in the code - Orch Spec does not know it (any more):"))
      plan.removals.foreach: f =>
        val r = f.removal.get
        if r.content.isEmpty then println(colored(Console.YELLOW, s"  the file ${f.path} (${r.names.mkString(", ")})"))
        else println(colored(Console.YELLOW, s"  ${r.names.mkString(", ")} in ${f.path}"))

  /** Ask whether what only the code has goes - `ask` gets the question, the answer is yes or no. */
  def askRemoval(plan: MergePlan, ask: String => Option[String] = readAnswer): Boolean =
    plan.removals.nonEmpty && {
      val n = plan.removals.flatMap(_.removal).map(_.names.size).sum
      ask(s"\nDelete the $n class(es), object(s) and case(s) only the code has? [y/N] ")
        .exists(a => Seq("y", "yes", "j", "ja").contains(a.trim.toLowerCase))
    }

  private def readAnswer(question: String): Option[String] =
    print(question)
    Option(scala.io.StdIn.readLine())

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

  private def planLine(f: PlannedFile): String =
    val text = s"${f.action.toString.padTo(9, ' ')} ${f.path}${f.note.fold("")(n => s" ($n)")}"
    f.action match
      case Action.conflict => colored(Console.YELLOW, text)
      case Action.delete   => colored(Console.RED, text)
      case _               => text

  /** grey - `Console` has none */
  private val Grey = "\u001b[90m"

  // the conflicts with their lines - a registration to add by hand as its snippet
  private def conflictLines(f: PlannedFile): Seq[String] =
    f.conflicts.flatMap: c =>
      if c.line == 0 then Seq(s"    add by hand:", c.spec.linesIterator.map(l => s"      $l").mkString("\n"))
      else s"    line ${c.line} ${colored(Console.RED, "- code")} ${colored(Console.GREEN, "+ orch-spec")} ${colored(Grey, "~ only the form")}:" +: diffLines(c)

  /** The lines of a conflict as `git diff` shows them: the code's red, the spec's green, a
    * change of the form (indentation) grey.
    */
  private[update] def diffLines(c: Conflict): Seq[String] =
    import ThreeWay.DiffLine
    ThreeWay.diff(c.code, c.spec).map:
      case DiffLine.Same(l) => s"      $l"
      case DiffLine.Form(l) => colored(Grey, s"    ~ $l")
      case DiffLine.Code(l) => colored(Console.RED, s"    - $l")
      case DiffLine.Spec(l) => colored(Console.GREEN, s"    + $l")

  private def printNotes(plan: MergePlan): Unit =
    plan.notes.foreach(n => println(colored(Console.YELLOW, n)))

end MergeReport
