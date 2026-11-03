package orchescala.helper.dev.update

import orchescala.helper.dev.update.merge.*

import scala.io.StdIn
import scala.util.Try

/** `./helper.scala processFromSpec --check | --merge` - the merge from Orch Spec in the console:
  *
  * {{{
  * ./helper.scala processFromSpec --check                      # plan: HEAD:spec -> spec/
  * ./helper.scala processFromSpec --check --from <dir>         # plan for another spec folder
  * ./helper.scala processFromSpec --merge [--from <dir>] [--markers] [--yes]
  * }}}
  * `--check` shows what changed in the spec (in business terms) and the plan - it writes nothing
  * (`--json <file>` writes the plan as JSON). `--merge` shows the same, asks, and executes exactly
  * that plan; conflicts stay as they are, or with `--markers` get conflict markers like `git merge`.
  *
  * The library (`merge.SpecMerge`) decides and writes - only this command prints and asks.
  */
case class OrchSpecMergeCommand()(using config: DevConfig):

  /** @return whether it went through - false for a wrong `--from` or a merge that stopped midway
    *         (the helper then ends with exit code 1, for a script or CI job that runs it)
    */
  def run(args: Seq[String]): Boolean =
    val merge   = args.contains("--merge")
    val markers = args.contains("--markers")
    val yes     = args.contains("--yes")
    def value(flag: String) = args.sliding(2).collectFirst { case Seq(`flag`, v) => v }
    val project = config.projectDir
    val after   = value("--from") match
      case Some(p) => Try(os.Path(p, os.pwd)).toEither.left.map(_ => s"--from $p is no path")
      case None    => Right(project / SpecSources.specDir)
    after.flatMap(dir => SpecSources.whyNoSpecFolder(dir).toLeft(dir)) match
      case Left(why)  =>
        println(Console.RED + s"$why - give the spec folder with --from <dir>." + Console.RESET)
        false
      case Right(dir) =>
        try checkAndMerge(project, dir, merge, markers, yes, value("--json"))
        catch
          // what the user can act on: a message, no stack trace
          case e @ (_: ToolTimeout | _: MergeAborted | _: java.io.IOException | _: IllegalArgumentException |
              _: IllegalStateException | _: os.SubprocessException) =>
            println(Console.RED + Option(e.getMessage).getOrElse(e.toString) + Console.RESET)
            false
  end run

  private def checkAndMerge(
      project: os.Path,
      after: os.Path,
      merge: Boolean,
      markers: Boolean,
      yes: Boolean,
      json: Option[String]
  ): Boolean =
    // the spec before: in the last commit - extracted once for the comparison and the plan;
    // inside the try, so whatever fails after the extraction, the folder is removed
    var before  = Option.empty[os.Path]
    try
      before = SpecSources.folder(project, SpecSource.GitRev("HEAD"))
      println(s"Spec before: ${if before.isDefined then "HEAD:spec" else "(none - the first merge)"} - after: $after")
      specDiff(before, after).foreach: text =>
        println("\nWhat changed in the spec:")
        print(text)
      val plan = SpecMerge.checkMerge(project, before.fold(SpecSource.Empty)(SpecSource.Dir(_)), SpecSource.Dir(after))
      println()
      MergeReport.printPlan(plan)
      json.foreach: file =>
        os.write.over(os.Path(file, os.pwd), plan.toJsonString, createFolders = true)
        println(s"Plan written to $file")
      if !merge then true
      else if !plan.hasChanges && !(markers && plan.hasConflicts) then
        println("Nothing to merge.")
        true
      else if yes || confirm(plan, markers) then
        try
          val result = SpecMerge.merge(project, plan, if markers then OnConflict.Markers else OnConflict.KeepCode)
          println()
          MergeReport.printMerged(plan, result, markers)
          OrchSpecGenerator().linkDiagrams(project)
          true
        catch
          case e: MergeIncomplete =>
            println()
            MergeReport.printIncomplete(e)
            false
      else
        println("Not merged.")
        true
      end if
    finally before.foreach(os.remove.all)
    end try
  end checkAndMerge

  private def confirm(plan: MergePlan, markers: Boolean): Boolean =
    val conflicts = plan.withAction(Action.conflict).size
    val what      =
      if conflicts == 0 then ""
      else if markers then s" - $conflicts file(s) get conflict markers"
      else s" - $conflicts file(s) with conflicts stay as they are"
    print(s"\nMerge into ${config.projectName}$what? [y/N] ")
    Option(StdIn.readLine()).exists(a => Seq("y", "yes", "j", "ja").contains(a.trim.toLowerCase))

  /** Orch Spec's comparison in business terms (`spec2diff.js`) - None without Node.js. If it
    * fails, why - the plan does not depend on it, so the command goes on.
    * @param script the tool - Orch Spec's, bundled in the orchescala-orch-doc jar
    */
  private[update] def specDiff(
      before: Option[os.Path],
      after: os.Path,
      script: => Array[Byte] = os.read.bytes(os.resource / "orch-doc-tools" / "spec2diff.js")
  ): Option[String] =
    Option.when(NodeSpecExporter.hasNode):
      Try:
        val dir  = os.temp.dir(prefix = "orch-spec-tools")
        val tool = dir / "spec2diff.js"
        try
          os.write(tool, script)
          val missing = dir / "no-spec-before"
          val r       = ExternalTool.call(Seq("node", tool.toString, before.getOrElse(missing).toString, after.toString), ExternalTool.diffTimeout)
          if r.exitCode != 0 then
            throw IllegalStateException(s"spec2diff.js failed (exit code ${r.exitCode}): ${r.err.text().trim}")
          r.out.text()
        finally os.remove.all(dir)
      .recover:
        case e => s"(the comparison of the spec is not available: ${Option(e.getMessage).getOrElse(e.getClass.getSimpleName)})\n"
      .get

end OrchSpecMergeCommand
