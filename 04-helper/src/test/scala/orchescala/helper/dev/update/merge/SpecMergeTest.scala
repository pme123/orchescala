package orchescala.helper.dev.update.merge

import munit.FunSuite
import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
import orchescala.helper.dev.update.{ModuleConfig, OrchSpecGenerator}
import orchescala.helper.util.DevConfig

/** The merge from Orch Spec: the export of the spec before (base) and after (new) against the
  * code of the project - the cases of the requirement. The export is the real output of
  * Orch Spec's `tools/spec2export.ts` for its test spec (`04-orch-spec/tests/fixtures/spec-folder`).
  */
class SpecMergeTest extends FunSuite:

  private lazy val order: ProcessExport =
    SpecExport.fromJson(os.read(os.resource / "orch-spec" / "order-export.json")).processes.head

  private val workerApp =
    """package acme.demo.worker
      |
      |object WorkerApp extends CompanyWorkerApp:
      |  workers(
      |    //TODO add workers here
      |  )
      |  dependencies(
      |  )
      |end WorkerApp
      |""".stripMargin

  private val apiCreator =
    """package acme.demo.api
      |
      |object ApiProjectCreator extends CompanyProjectCreator:
      |  document(
      |  )
      |end ApiProjectCreator
      |""".stripMargin

  /** A project `acme-demo` in a temporary folder - with an empty WorkerApp and ApiProjectCreator. */
  private def inProject(body: DevConfig ?=> os.Path => Unit): Unit =
    val root = os.temp.dir(prefix = "spec-merge-")
    val dir  = root / "acme-demo"
    os.makeDir(dir)
    try
      os.dynamicPwd.withValue(dir):
        given DevConfig = DevConfig(
          ApiProjectConfig(
            "acme-demo",
            VersionConfig("0.1.0-SNAPSHOT"),
            Seq.empty,
            Seq.empty,
            Seq.empty,
            ModuleType.projectModules
          )
        )
        os.write(dir / workerAppRel, workerApp, createFolders = true)
        os.write(dir / apiCreatorRel, apiCreator, createFolders = true)
        body(dir)
    finally os.remove.all(root)
  end inProject

  private def workerAppRel(using config: DevConfig)  =
    ModuleConfig.workerModule.packagePath(config.projectPath) / "WorkerApp.scala"
  private def apiCreatorRel(using config: DevConfig) =
    ModuleConfig.apiModule.packagePath(config.projectPath) / "ApiProjectCreator.scala"

  private def file(project: os.Path, name: String): os.Path =
    os.walk(project).find(_.last == name).getOrElse(fail(s"$name not in the project"))
  private def path(project: os.Path, name: String): String =
    file(project, name).relativeTo(project).toString

  private def run(
      project: os.Path,
      before: Seq[ProcessExport],
      after: Seq[ProcessExport],
      onConflict: OnConflict = OnConflict.KeepCode,
      formatter: XmlFormatter = XmlFormatter.default
  )(using DevConfig): (MergePlan, MergeResult) =
    val plan = SpecMerge.plan(project, before, after, formatter = formatter)
    plan -> SpecMerge.merge(project, plan, onConflict)

  private def actionOf(plan: MergePlan, project: os.Path, name: String): Action =
    plan.files.find(_.path == path(project, name)).map(_.action).getOrElse(fail(s"$name not in the plan"))

  private def editScala(e: ProcessExport)(change: String => String): ProcessExport = e.copy(scala = change(e.scala))

  private def editFile(project: os.Path, name: String)(change: String => String): Unit =
    val f = file(project, name)
    os.write.over(f, change(os.read(f)))

  /** The export without the file of an object (its section in the Scala export). */
  private def withoutObject(e: ProcessExport, name: String): ProcessExport =
    val rule  = "// " + "─" * 72
    val parts = e.scala.split(java.util.regex.Pattern.quote(rule + "\n"), -1).toSeq
    // a file comes as …, "path\n", "content", … - the rule before its path goes to the next path
    val at    = parts.indexWhere(_.contains(s"/$name.scala"))
    e.copy(scala = parts.patch(at, Nil, 2).mkString(rule + "\n"))

  /** A second custom task: CheckOrder copied as SendMail. */
  private def withSendMail(e: ProcessExport): ProcessExport =
    val rule  = "// " + "─" * 72
    val start = e.scala.indexOf(s"$rule\n// 01-domain/src/main/scala/acme/demo/domain/order/v1/CheckOrder.scala")
    val end   = e.scala.indexOf(rule, e.scala.indexOf("end CheckOrder"))
    val copy  = e.scala.substring(start, end).replace("CheckOrder", "SendMail").replace("checkOrder", "sendMail")
    e.copy(scala = e.scala.substring(0, end) + copy + e.scala.substring(end))

  test("a new process: everything created, registered in the WorkerApp and the ApiProjectCreator"):
    inProject: project =>
      val (plan, result) = run(project, Seq.empty, Seq(order))
      assertEquals(plan.withAction(Action.conflict), Seq.empty)
      for name <- Seq("Order.scala", "CheckOrder.scala", "ApproveOrderUT.scala", "Customer.scala", "demo-orderV1.bpmn",
          "OrderWorker.scala", "CheckOrderWorker.scala", "CheckOrderWorkerTest.scala", "OrderSimulation.scala")
      do assertEquals(actionOf(plan, project, name), Action.create, name)
      assertEquals(actionOf(plan, project, "WorkerApp.scala"), Action.merged)
      assert(result.written.contains(path(project, "CheckOrderWorker.scala")))
      val app = os.read(project / workerAppRel)
      assert(app.contains("    orderWorkers,"), app)
      assert(app.contains("      CheckOrderWorker(),"), app)
      val api = os.read(project / apiCreatorRel)
      assert(api.contains("api(Order.example)("), api)
      assert(api.contains("      ApproveOrderUT.example,"), api)

  test("twice the same export: all unchanged"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      val plan = SpecMerge.plan(project, Seq(order), Seq(order))
      assertEquals(plan.files.filterNot(_.action == Action.unchanged), Seq.empty)
      assert(!plan.hasChanges)

  test("the developer changed, Orch Spec not: the code stays"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "CheckOrderWorker.scala")(_.replace("???", "Right(Out(ok = true))"))
      editFile(project, "CheckOrder.scala")(_.replace("end CheckOrder", "  lazy val own = 1\nend CheckOrder"))
      val (plan, _) = run(project, Seq(order), Seq(order))
      assertEquals(actionOf(plan, project, "CheckOrderWorker.scala"), Action.unchanged)
      assertEquals(actionOf(plan, project, "CheckOrder.scala"), Action.unchanged)
      assert(os.read(file(project, "CheckOrder.scala")).contains("lazy val own = 1"))

  test("Orch Spec changed, the developer not: the new one is taken"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      val changed   = editScala(order)(_.replace("ok = true", "ok = false"))
      val (plan, _) = run(project, Seq(order), Seq(changed))
      assertEquals(actionOf(plan, project, "CheckOrder.scala"), Action.update)
      assert(os.read(file(project, "CheckOrder.scala")).contains("ok = false"))

  test("both changed the same file in different places: merged"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "CheckOrder.scala")(_.replace("end CheckOrder", "  lazy val own = 1\nend CheckOrder"))
      val changed   = editScala(order)(_.replace("ok = true", "ok = false"))
      val (plan, _) = run(project, Seq(order), Seq(changed))
      assertEquals(actionOf(plan, project, "CheckOrder.scala"), Action.merged)
      val merged    = os.read(file(project, "CheckOrder.scala"))
      assert(merged.contains("ok = false") && merged.contains("lazy val own = 1"), merged)

  test("both changed the same place: conflict - KeepCode leaves the file as it is"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "CheckOrder.scala")(_.replace("ok = true", "ok = true // as the developer wants it"))
      val code           = os.read(file(project, "CheckOrder.scala"))
      val changed        = editScala(order)(_.replace("ok = true", "ok = false"))
      val (plan, result) = run(project, Seq(order), Seq(changed))
      val conflict       = plan.files.find(_.path == path(project, "CheckOrder.scala")).get
      assertEquals(conflict.action, Action.conflict)
      assertEquals(conflict.conflicts.map(c => (c.code.trim, c.spec.trim)), Seq("ok = true // as the developer wants it" -> "ok = false"))
      assertEquals(conflict.conflicts.head.line, code.linesIterator.indexWhere(_.contains("as the developer")) + 1)
      assertEquals(os.read(file(project, "CheckOrder.scala")), code)
      assertEquals(result.conflicts.map(_.path), Seq(conflict.path))

  test("both changed the same place: conflict - Markers writes conflict markers like git merge"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "CheckOrder.scala")(_.replace("ok = true", "ok = true // as the developer wants it"))
      val changed        = editScala(order)(_.replace("ok = true", "ok = false"))
      val (_, result)    = run(project, Seq(order), Seq(changed), OnConflict.Markers)
      val marked         = os.read(file(project, "CheckOrder.scala"))
      assert(marked.contains("<<<<<<< code\n      ok = true // as the developer wants it\n=======\n      ok = false\n>>>>>>> orch-spec"), marked)
      assert(result.written.contains(path(project, "CheckOrder.scala")))

  test("removed in Orch Spec, the code unchanged: deleted - and its registration goes"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      val removed   = withoutObject(order, "ApproveOrderUT")
      val approve   = path(project, "ApproveOrderUT.scala")
      val (plan, r) = run(project, Seq(order), Seq(removed))
      assertEquals(plan.files.find(_.path == approve).map(_.action), Some(Action.delete))
      assertEquals(r.deleted, Seq(approve))
      assert(!os.exists(project / os.RelPath(approve)))
      val api       = os.read(project / apiCreatorRel)
      assert(!api.contains("ApproveOrderUT.example"), api)
      assert(api.contains("CheckOrder.example"), api)

  test("removed in Orch Spec, changed in the code: conflict"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "ApproveOrderUT.scala")(_.replace("end ApproveOrderUT", "  lazy val own = 1\nend ApproveOrderUT"))
      val (plan, _) = run(project, Seq(order), Seq(withoutObject(order, "ApproveOrderUT")))
      val approve   = plan.files.find(_.path == path(project, "ApproveOrderUT.scala")).get
      assertEquals(approve.action, Action.conflict)
      assertEquals(approve.note, Some("in orch-spec entfernt, im Code geändert"))
      assert(os.exists(file(project, "ApproveOrderUT.scala")))

  test("a new step (custom task): its object and worker created, the worker registered"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      val (plan, _) = run(project, Seq(order), Seq(withSendMail(order)))
      for name <- Seq("SendMail.scala", "SendMailWorker.scala", "SendMailWorkerTest.scala") do
        assertEquals(actionOf(plan, project, name), Action.create, name)
      assertEquals(actionOf(plan, project, "WorkerApp.scala"), Action.merged)
      assertEquals(actionOf(plan, project, "CheckOrderWorker.scala"), Action.unchanged)
      val app       = os.read(project / workerAppRel)
      assert(app.contains("      SendMailWorker(),") && app.contains("      CheckOrderWorker(),"), app)
      // and away again
      val (back, _) = run(project, Seq(withSendMail(order)), Seq(order))
      assertEquals(actionOf(back, project, "WorkerApp.scala"), Action.merged)
      assert(!os.read(project / workerAppRel).contains("SendMailWorker"), os.read(project / workerAppRel))
      assert(os.walk(project).forall(_.last != "SendMailWorker.scala"))

  test("a process removed as a whole: its files deleted, its blocks out of the registrations"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      val (plan, _) = run(project, Seq(order), Seq.empty)
      assertEquals(plan.withAction(Action.conflict), Seq.empty)
      assert(os.walk(project).forall(_.last != "CheckOrder.scala"))
      assertEquals(os.read(project / workerAppRel), workerApp)
      assertEquals(os.read(project / apiCreatorRel), apiCreator)

  test("a BPMN where Orch Spec changed only the layout: no conflict with the developer's change"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "demo-orderV1.bpmn")(_.replace("""name="approve order"""", """name="approve the order""""))
      val layout    = order.copy(bpmn = order.bpmn.map(_.replace("""<dc:Bounds x="100" y="100"""", """<dc:Bounds x="120" y="100"""")))
      val (plan, _) = run(project, Seq(order), Seq(layout))
      assertEquals(actionOf(plan, project, "demo-orderV1.bpmn"), Action.merged)
      val bpmn      = os.read(file(project, "demo-orderV1.bpmn"))
      assert(bpmn.contains("approve the order") && bpmn.contains("""x="120""""), bpmn)

  /** A formatter for the test: the lines without their indentation. */
  private object Unindent extends XmlFormatter:
    def format(texts: Map[String, String]): Map[String, String] =
      texts.view.mapValues(_.linesIterator.map(_.trim).mkString("", "\n", "\n")).toMap

  test("a BPMN in another form in the code: formatted before the comparison - no conflict, written formatted"):
    inProject: project =>
      run(project, Seq.empty, Seq(order), formatter = Unindent)
      // the Modeler indents differently
      editFile(project, "demo-orderV1.bpmn")(_.linesIterator.map("    " + _).mkString("\n"))
      val layout    = order.copy(bpmn = order.bpmn.map(_.replace("""<dc:Bounds x="100" y="100"""", """<dc:Bounds x="120" y="100"""")))
      val unformed  = SpecMerge.plan(project, Seq(order), Seq(layout), formatter = NoXmlFormatter)
      assertEquals(actionOf(unformed, project, "demo-orderV1.bpmn"), Action.conflict)
      val (plan, _) = run(project, Seq(order), Seq(layout), formatter = Unindent)
      assertEquals(actionOf(plan, project, "demo-orderV1.bpmn"), Action.update)
      val bpmn      = os.read(file(project, "demo-orderV1.bpmn"))
      assert(bpmn.contains("""x="120"""") && !bpmn.contains("    <"), bpmn)
      // only the form differs: unchanged, the file is not touched
      editFile(project, "demo-orderV1.bpmn")(_.linesIterator.map("  " + _).mkString("\n"))
      assertEquals(actionOf(SpecMerge.plan(project, Seq(order), Seq(layout), formatter = Unindent), project, "demo-orderV1.bpmn"), Action.unchanged)

  test("a file changed between check and merge: the merge aborts, nothing is written"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      val plan    = SpecMerge.plan(project, Seq(order), Seq(withSendMail(editScala(order)(_.replace("ok = true", "ok = false")))))
      editFile(project, "CheckOrderWorker.scala")(_ + "// later\n")
      val app     = os.read(project / workerAppRel)
      val aborted = intercept[MergeAborted](SpecMerge.merge(project, plan, OnConflict.KeepCode))
      assertEquals(aborted.changed, Seq(path(project, "CheckOrderWorker.scala")))
      assert(os.read(file(project, "CheckOrder.scala")).contains("ok = true"))
      assertEquals(os.read(project / workerAppRel), app)
      assert(os.walk(project).forall(_.last != "SendMail.scala"))

  test("the plan as JSON - read back the same"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "CheckOrder.scala")(_.replace("ok = true", "ok = true // dev"))
      val plan = SpecMerge.plan(project, Seq(order), Seq(editScala(order)(_.replace("ok = true", "ok = false"))))
      val json = plan.toJsonString
      assertEquals(MergePlan.fromJson(json), plan)
      assert(json.contains("\"summary\""), json)
      assert(json.contains("\"conflict\" : 1"), json)

  test("the process object without a base: the types of Orch Spec merged by structure, the rest stays"):
    inProject: project =>
      run(project, Seq.empty, Seq(order))
      editFile(project, "Order.scala")(_.replace("  lazy val example = process(", "  lazy val own = 1\n\n  lazy val example = process("))
      val changed   = editScala(order)(_.replace("approved: Boolean", "approved: Boolean,\n      reason: Option[String]"))
      val (plan, _) = run(project, Seq.empty, Seq(changed))
      assertEquals(actionOf(plan, project, "Order.scala"), Action.merged)
      val obj       = os.read(file(project, "Order.scala"))
      assert(obj.contains("reason: Option[String]") && obj.contains("lazy val own = 1"), obj)
      // a worker that exists stays without a base
      assertEquals(actionOf(plan, project, "OrderWorker.scala"), Action.unchanged)

  test("processFromSpec orchspec: (one process, no base) - creates, then leaves what differs"):
    inProject: project =>
      OrchSpecGenerator().createProcess(order.bpmn, order.scala, order.dmns)
      assert(os.read(file(project, "CheckOrder.scala")).contains("object CheckOrder"))
      editFile(project, "CheckOrder.scala")(_.replace("ok = true", "ok = true // dev"))
      OrchSpecGenerator().createProcess(order.bpmn, editScala(order)(_.replace("ok = true", "ok = false")).scala, order.dmns)
      assert(os.read(file(project, "CheckOrder.scala")).contains("ok = true // dev"))
      assert(os.read(project / workerAppRel).contains("orderWorkers"))

  /** A fake export: the spec folder carries its export as `export.json` - so no Node.js is needed. */
  private object FileExporter extends SpecExporter:
    def exportOf(specDir: os.Path): SpecExport =
      os.read(specDir / "export.json") match
        case json => SpecExport.fromJson(json)

  private def exportJson(e: ProcessExport): String =
    import io.circe.syntax.*
    io.circe.Json.obj(
      "v"       -> 1.asJson,
      "entries" -> Seq(io.circe.Json.obj(
        "kind"  -> "process".asJson,
        "slug"  -> e.slug.asJson,
        "bpmn"  -> e.bpmn.asJson,
        "scala" -> e.scala.asJson,
        "dmns"  -> Seq.empty[String].asJson
      )).asJson,
      "issues"  -> Seq.empty[String].asJson
    ).spaces2

  test("checkMerge: base from the spec in git HEAD, new from a folder - spec/ taken over 1:1"):
    inProject: project =>
      def git(args: String*) = os.proc("git", "-c", "user.name=t", "-c", "user.email=t@example.com", args).call(cwd = project, stderr = os.Pipe)
      os.write(project / "spec" / "export.json", exportJson(order), createFolders = true)
      os.write(project / "spec" / "pages" / "old.json", "{}", createFolders = true)
      git("init", "-q")
      git("add", "-A")
      git("commit", "-q", "-m", "spec")
      SpecMerge.merge(project, SpecMerge.checkMerge(project, SpecSource.Empty, SpecSource.GitRev("HEAD"), FileExporter), OnConflict.KeepCode)
      val sent = os.temp.dir(prefix = "sent-")
      os.write(sent / "export.json", exportJson(withSendMail(order)))
      os.write(sent / "pages" / "book.json", """{"path":"/book"}""", createFolders = true)
      val plan = SpecMerge.checkMerge(project, SpecSource.GitRev("HEAD"), SpecSource.Dir(sent), FileExporter)
      def spec(p: String) = plan.files.find(_.path == p).map(f => f.owner -> f.action)
      assertEquals(spec("spec/export.json"), Some(Owner.spec -> Action.update))
      assertEquals(spec("spec/pages/book.json"), Some(Owner.spec -> Action.create))
      assertEquals(spec("spec/pages/old.json"), Some(Owner.spec -> Action.delete))
      assertEquals(actionOf(plan, project, "CheckOrder.scala"), Action.unchanged)
      assertEquals(plan.files.find(_.path.endsWith("SendMail.scala")).map(_.action), Some(Action.create))
      SpecMerge.merge(project, plan, OnConflict.KeepCode)
      assertEquals(os.read(project / "spec" / "pages" / "book.json"), """{"path":"/book"}""")
      assert(!os.exists(project / "spec" / "pages" / "old.json"))
      // the spec of the project itself: nothing more to do
      val again = SpecMerge.checkMerge(project, SpecSource.Dir(sent), SpecSource.Dir(project / "spec"), FileExporter)
      assertEquals(again.files.filterNot(_.action == Action.unchanged), Seq.empty)
      os.remove.all(sent)

  test("ThreeWay - like git merge"):
    val base = "a\nb\nc\nd\ne\n"
    assertEquals(ThreeWay.merge(base, "A\nb\nc\nd\ne\n", "a\nb\nc\nd\nE\n").text, "A\nb\nc\nd\nE\n")
    val conflict = ThreeWay.merge(base, "a\nB\nc\nd\ne\n", "a\nX\nc\nd\ne\n")
    assertEquals(conflict.conflicts, Seq(Conflict(2, "X", "B")))
    assertEquals(conflict.text, "a\n<<<<<<< code\nB\n=======\nX\n>>>>>>> orch-spec\nc\nd\ne\n")

end SpecMergeTest
