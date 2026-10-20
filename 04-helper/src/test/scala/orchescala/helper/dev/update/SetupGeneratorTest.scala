package orchescala.helper.dev.update

import SetupGenerator.DiagramsLink

class SetupGeneratorTest extends munit.FunSuite:

  // deleteOnExit does not delete a directory with files in it - removed after the suite
  private val dirs = scala.collection.concurrent.TrieMap.empty[os.Path, Unit]
  override def afterAll(): Unit =
    dirs.keys.foreach(os.remove.all)
    super.afterAll()

  private def project(withBpmn: Boolean, withWorkerResources: Boolean = true): os.Path =
    val dir = os.temp.dir()
    dirs.put(dir, ())
    if withWorkerResources then os.makeDir.all(dir / "03-worker" / "src" / "main" / "resources")
    if withBpmn then os.write(dir / "src" / "main" / "resources" / "camunda" / "p.bpmn", "<x/>", createFolders = true)
    dir

  test("a project with diagrams and no link gets the relative link - and the worker app sees the diagrams"):
    val dir = project(withBpmn = true)
    assertEquals(SetupGenerator.ensureDiagramsLink(dir), DiagramsLink.Linked)
    val link = SetupGenerator.diagramsLink(dir)
    assertEquals(os.readLink(link).toString, "../../../../src/main/resources/camunda")
    assert(os.exists(link / "p.bpmn"))

  test("an existing link stays - nothing is added twice"):
    val dir = project(withBpmn = true)
    SetupGenerator.ensureDiagramsLink(dir)
    assertEquals(SetupGenerator.ensureDiagramsLink(dir), DiagramsLink.Exists)

  test("a broken link is the project's - it stays as it is"):
    val dir  = project(withBpmn = true)
    val link = SetupGenerator.diagramsLink(dir)
    os.symlink(link, os.rel / "nowhere")
    assertEquals(SetupGenerator.ensureDiagramsLink(dir), DiagramsLink.Exists)
    assertEquals(os.readLink(link).toString, "nowhere")

  test("no diagrams - no link"):
    val dir = project(withBpmn = false)
    assertEquals(SetupGenerator.ensureDiagramsLink(dir), DiagramsLink.NoDiagrams)
    assert(!os.exists(SetupGenerator.diagramsLink(dir), followLinks = false))

  test("no resources of the worker app - reported, nothing created (processFromSpec warns)"):
    val dir = project(withBpmn = true, withWorkerResources = false)
    assertEquals(SetupGenerator.ensureDiagramsLink(dir), DiagramsLink.NoWorkerResources)
    assert(!os.exists(dir / "03-worker"))

  test("the link cannot be created - reported as Failed, processFromSpec warns and goes on"):
    val dir       = project(withBpmn = true, withWorkerResources = false)
    // a file where the directory `resources` should be: no link can be created in it - also not as
    // root or on Windows (a read-only directory would not stop root)
    os.write(dir / "03-worker" / "src" / "main" / "resources", "not a directory", createFolders = true)
    SetupGenerator.ensureDiagramsLink(dir) match
      case DiagramsLink.Failed(reason) => assert(reason.nonEmpty)
      case other                       => fail(s"expected Failed, got $other")

end SetupGeneratorTest
