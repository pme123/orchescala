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
    BpmnProcessGenerator(config.bpmnProcessType).createBpmn(setupElement)
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
    os.remove(os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.html")
    os.symlink(
      os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.html",
      os.pwd / "03-api" / "OpenApi.html"
    )
    os.remove(os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.yml")
    os.symlink(
      os.pwd / "03-worker" / "src" / "main" / "resources" / "OpenApi.yml",
      os.pwd / "03-api" / "OpenApi.yml"
    )
    os.remove.all(os.pwd / "03-worker" / "src" / "main" / "resources" / "diagrams")
    os.symlink(
      os.pwd / "03-worker" / "src" / "main" / "resources" / "diagrams",
      os.pwd / "src" / "main" / "resources" / "camunda"
    )
  end addSymLinks

end SetupGenerator
