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

  def run(args: Seq[String]): Unit =
    val merge   = args.contains("--merge")
    val markers = args.contains("--markers")
    val yes     = args.contains("--yes")
    def value(flag: String) = args.sliding(2).collectFirst { case Seq(`flag`, v) => v }
    val project = config.projectDir
    val after   = value("--from").map(p => os.Path(p, os.pwd)).getOrElse(project / SpecSources.specDir)
    if !os.isDir(after) then
      throw IllegalArgumentException(s"No spec folder $after - give it with --from <dir>.")
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
      value("--json").foreach: file =>
        os.write.over(os.Path(file, os.pwd), plan.toJsonString, createFolders = true)
        println(s"Plan written to $file")
      if merge then
        if !plan.hasChanges && !(markers && plan.hasConflicts) then println("Nothing to merge.")
        else if yes || confirm(plan, markers) then
          val result = SpecMerge.merge(project, plan, if markers then OnConflict.Markers else OnConflict.KeepCode)
          println()
          MergeReport.printMerged(plan, result, markers)
          OrchSpecGenerator().linkDiagrams(project)
        else println("Not merged.")
    finally before.foreach(os.remove.all)
  end run

  private def confirm(plan: MergePlan, markers: Boolean): Boolean =
    val conflicts = plan.withAction(Action.conflict).size
    val what      =
      if conflicts == 0 then ""
      else if markers then s" - $conflicts file(s) get conflict markers"
      else s" - $conflicts file(s) with conflicts stay as they are"
    print(s"\nMerge into ${config.projectName}$what? [y/N] ")
    Option(StdIn.readLine()).exists(a => Seq("y", "yes", "j", "ja").contains(a.trim.toLowerCase))

  /** Orch Spec's comparison in business terms (`spec2diff.js`) - None without Node.js. */
  private def specDiff(before: Option[os.Path], after: os.Path): Option[String] =
    Option.when(NodeSpecExporter.hasNode):
      Try:
        val dir    = os.temp.dir(prefix = "orch-spec-tools")
        val script = dir / "spec2diff.js"
        os.write(script, os.read.bytes(os.resource / "orch-doc-tools" / "spec2diff.js"))
        try
          val missing = dir / "no-spec-before"
          val r       = ExternalTool.call(Seq("node", script.toString, before.getOrElse(missing).toString, after.toString), ExternalTool.nodeTimeout)
          if r.exitCode != 0 then throw os.SubprocessException(r)
          r.out.text()
        finally os.remove.all(dir)
      .getOrElse("(the comparison of the spec is not available)\n")

end OrchSpecMergeCommand
