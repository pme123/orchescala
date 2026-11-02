package orchescala.helper.dev.update.merge

import munit.FunSuite
import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
import orchescala.helper.dev.update.OrchSpecMergeCommand
import orchescala.helper.util.DevConfig

/** End to end with Orch Spec's own tools (spec2export.js, spec2diff.js from the orchescala-orch-doc
  * jar) and Node.js: the test spec of Orch Spec (`04-orch-spec/tests/fixtures/spec-folder`) as the
  * `spec/` of a project, merged with `processFromSpec --merge`. Skipped without Node.js.
  */
class SpecMergeNodeTest extends FunSuite:

  private lazy val fixture = os.pwd / "04-orch-spec" / "tests" / "fixtures" / "spec-folder"

  private def inGitProject(body: DevConfig ?=> os.Path => Unit): Unit =
    assume(NodeSpecExporter.hasNode, "no Node.js")
    assume(os.isDir(fixture), s"no $fixture")
    val root = os.temp.dir(prefix = "spec-merge-node-")
    val dir  = root / "acme-demo"
    os.makeDir(dir)
    try
      os.dynamicPwd.withValue(dir):
        given DevConfig = DevConfig(
          ApiProjectConfig("acme-demo", VersionConfig("0.1.0-SNAPSHOT"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
        )
        os.proc("git", "init", "-q").call(cwd = dir)
        body(dir)
    finally os.remove.all(root)

  private def git(project: os.Path, args: String*) =
    os.proc("git", "-c", "user.name=t", "-c", "user.email=t@example.com", args).call(cwd = project, stderr = os.Pipe)

  test("the export of Orch Spec's tool - the same as the fixture of the merge tests"):
    inGitProject: _ =>
      val exported = NodeSpecExporter.exportOf(fixture)
      val fixed    = SpecExport.fromJson(os.read(os.resource / "orch-spec" / "order-export.json"))
      assertEquals(exported, fixed)

  test("processFromSpec --merge: the first merge creates the process, a change of a field arrives in the code"):
    inGitProject: project =>
      os.copy(fixture, project / "spec")
      OrchSpecMergeCommand().run(Seq("--merge", "--yes"))
      val checkOrder = os.walk(project).find(_.last == "CheckOrder.scala").get
      assert(os.read(checkOrder).contains("ok: Boolean"))
      git(project, "add", "-A")
      git(project, "commit", "-q", "-m", "first merge")
      // the developer implements, the RE changes the type of a field in Orch Spec
      os.write.over(checkOrder, os.read(checkOrder).replace("end CheckOrder", "  lazy val own = 1\nend CheckOrder"))
      val json       = project / "spec" / "processes" / "order.json"
      os.write.over(json, os.read(json).replace(""""name": "ok",
          "type": "Boolean"""", """"name": "ok",
          "type": "String""""))
      val plan       = SpecMerge.checkMerge(project, SpecSource.GitRev("HEAD"), SpecSource.Dir(project / "spec"))
      assertEquals(plan.files.find(_.path.endsWith("CheckOrder.scala")).map(_.action), Some(Action.merged))
      OrchSpecMergeCommand().run(Seq("--merge", "--yes"))
      val merged     = os.read(checkOrder)
      assert(merged.contains("ok: String") && merged.contains("lazy val own = 1"), merged)

  test("Orch Spec's formatter: a BPMN of the Modeler (other indentation, attribute order, <a></a>) is no change"):
    inGitProject: project =>
      assume(NodeXmlFormatter.available, "no xmlformat.js")
      val order    = SpecExport.fromJson(os.read(os.resource / "orch-spec" / "order-export.json")).processes.head
      SpecMerge.merge(project, SpecMerge.plan(project, Seq.empty, Seq(order)), OnConflict.KeepCode)
      val bpmn     = os.walk(project).find(_.last == "demo-orderV1.bpmn").get
      val modeler  = os.read(bpmn)
        .replace("""<bpmn:sequenceFlow id="F1" sourceRef="StartEvent" targetRef="CheckOrderTask" />""",
          """<bpmn:sequenceFlow targetRef="CheckOrderTask" sourceRef="StartEvent" id="F1"></bpmn:sequenceFlow>""")
        .linesIterator.map("\t" + _).mkString("\r\n")
      os.write.over(bpmn, modeler)
      val same     = SpecMerge.plan(project, Seq(order), Seq(order))
      assertEquals(same.files.find(_.path.endsWith(".bpmn")).map(_.action), Some(Action.unchanged))
      val layout   = order.copy(bpmn = order.bpmn.map(_.replace("""<dc:Bounds x="100" y="100"""", """<dc:Bounds x="120" y="100"""")))
      val plan     = SpecMerge.plan(project, Seq(order), Seq(layout))
      assertEquals(plan.files.find(_.path.endsWith(".bpmn")).map(_.action), Some(Action.update))
      SpecMerge.merge(project, plan, OnConflict.KeepCode)
      assertEquals(os.read(bpmn), NodeXmlFormatter.format(Map("x" -> layout.bpmn.get))("x"))

end SpecMergeNodeTest
