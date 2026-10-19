package orchescala.helper.dev.update
import orchescala.helper.util.DevConfig

case class SetupGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    println(
      s"The following Files (red) were not updated! - if you want so add $doNotAdjust at the top of these file."
    )
    DirectoryGenerator().generate
    SbtGenerator().generate
    SbtSettingsGenerator(isGateway = false).generate
    GenericFileGenerator().generate
    WorkerGenerator().generate
    SimulationGenerator().generate
    DmnGenerator().generate
    ApiGeneratorGenerator().generate
    ApiGenerator().generate
    addSymLinks()
  end generate

  def createProcess(setupElement: SetupElement): Unit =
    BpmnGenerator().createProcess(setupElement)
    BpmnProcessGenerator(config.projectBpmnProcessType).createBpmn(setupElement)
    SimulationGenerator().createSimulation(setupElement)
    WorkerGenerator().createProcessWorker(setupElement)
  end createProcess

  def createProcessElement(setupObject: SetupElement): Unit =
    BpmnGenerator().createProcessElement(setupObject)
    WorkerGenerator().createWorker(setupObject)

  def createUserTask(setupObject: SetupElement): Unit =
    BpmnGenerator().createProcessElement(setupObject)

  def createDecision(setupObject: SetupElement): Unit =
    BpmnGenerator().createProcessElement(setupObject)

  def createEvent(setupElement: SetupElement, withWorker: Boolean = true): Unit =
    BpmnGenerator().createEvent(setupElement)
    if withWorker then WorkerGenerator().createEventWorker(setupElement)

  def addSymLinks(): Unit =
    val basePath = os.rel / os.up / os.up / os.up / os.up
    os.remove(os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.html")
    os.symlink(
      os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.html",
      basePath / "03-api" / "OpenApi.html"
    )
    os.remove(os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.yml")
    os.symlink(
      os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.yml",
      basePath / "03-api" / "OpenApi.yml"
    )
    if os.exists(os.pwd / "src" / "main" / "resources" / "camunda") then
      os.remove.all(SetupGenerator.diagramsLink(os.pwd))
      SetupGenerator.linkDiagrams(os.pwd)
  end addSymLinks

end SetupGenerator

object SetupGenerator:
  /** The worker app serves its BPMN and DMN from `diagrams/` of its resources (`/docs/diagrams/…`). */
  def diagramsLink(projectDir: os.Path): os.Path =
    projectDir / "03-worker" / "src" / "main" / "resources" / "diagrams"

  /** The link `diagrams` -> `src/main/resources/camunda` (relative). */
  def linkDiagrams(projectDir: os.Path): Unit =
    os.symlink(diagramsLink(projectDir), os.rel / os.up / os.up / os.up / os.up / "src" / "main" / "resources" / "camunda")

  /** The link, if there are diagrams and no link yet - a project set up before its first BPMN
    * (`processFromSpec` later) had none: its diagrams were missing in its docs.
    */
  def ensureDiagramsLink(projectDir: os.Path): Boolean =
    val link = diagramsLink(projectDir)
    val add  = os.exists(projectDir / "src" / "main" / "resources" / "camunda") &&
      os.exists(projectDir / "03-worker" / "src" / "main" / "resources") &&
      !os.exists(link, followLinks = false)
    if add then linkDiagrams(projectDir)
    add
  end ensureDiagramsLink
end SetupGenerator
