package orchescala.helper.dev.update

import orchescala.helper.dev.update.merge.*

/** The output of the merge from Orch Spec in the console - the library itself prints nothing. */
object MergeReport:

  private def colored(color: String, text: String) = s"$color$text${Console.RESET}"

  /** The plan before the merge (`--check`): per file what will happen, then the summary. */
  def printPlan(plan: MergePlan): Unit =
    println(s"Merge plan for ${plan.project}:")
    plan.files.filterNot(_.action == Action.unchanged).foreach: f =>
      println(planLine(f))
      conflictLines(f).foreach(println)
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
        case Action.unchanged => println(s"UNCHANGED: ${f.path}${f.note.fold("")(n => s" ($n)")}")
        case Action.conflict  =>
          val what =
            if markers && f.content.isDefined then "conflict markers written - resolve them in the IDE"
            else "merge it manually, or delete it and run again"
          println(colored(Console.YELLOW, s"DIFFERS from Orch Spec: ${f.path}${f.note.fold("")(n => s" ($n)")} - $what."))
          conflictLines(f).foreach(println)
    printNotes(plan)
    println(summary(plan))
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

  private def planLine(f: PlannedFile): String =
    val text = s"${f.action.toString.padTo(9, ' ')} ${f.path}${f.note.fold("")(n => s" ($n)")}"
    f.action match
      case Action.conflict => colored(Console.YELLOW, text)
      case Action.delete   => colored(Console.RED, text)
      case _               => text

  // the conflicts with their lines - a registration to add by hand as its snippet
  private def conflictLines(f: PlannedFile): Seq[String] =
    f.conflicts.flatMap: c =>
      if c.line == 0 then Seq(s"    add by hand:", c.spec.linesIterator.map(l => s"      $l").mkString("\n"))
      else
        Seq(s"    line ${c.line}:") ++
          Option.when(c.code.nonEmpty)(c.code.linesIterator.map(l => s"      code      | $l").mkString("\n")) ++
          Option.when(c.spec.nonEmpty)(c.spec.linesIterator.map(l => s"      orch-spec | $l").mkString("\n"))

  private def printNotes(plan: MergePlan): Unit =
    plan.notes.foreach(n => println(colored(Console.YELLOW, n)))

end MergeReport
