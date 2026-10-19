package orchescala.helper.dev.update

class SetupGeneratorTest extends munit.FunSuite:

  private def project(withBpmn: Boolean): os.Path =
    val dir = os.temp.dir()
    os.makeDir.all(dir / "03-worker" / "src" / "main" / "resources")
    if withBpmn then os.write(dir / "src" / "main" / "resources" / "camunda" / "p.bpmn", "<x/>", createFolders = true)
    dir

  test("a project with diagrams and no link gets the relative link - and the worker app sees the diagrams"):
    val dir = project(withBpmn = true)
    assert(SetupGenerator.ensureDiagramsLink(dir))
    val link = SetupGenerator.diagramsLink(dir)
    assertEquals(os.readLink(link).toString, "../../../../src/main/resources/camunda")
    assert(os.exists(link / "p.bpmn"))

  test("an existing link stays - nothing is added twice"):
    val dir = project(withBpmn = true)
    SetupGenerator.ensureDiagramsLink(dir)
    assert(!SetupGenerator.ensureDiagramsLink(dir))

  test("no diagrams - no link"):
    val dir = project(withBpmn = false)
    assert(!SetupGenerator.ensureDiagramsLink(dir))
    assert(!os.exists(SetupGenerator.diagramsLink(dir), followLinks = false))

end SetupGeneratorTest
