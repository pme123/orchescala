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
  end generate

  lazy val generateGateway: Unit =
    println(
      s"The following Files (red) were not updated! - if you want so add $doNotAdjust at the top of these file."
    )
    DirectoryGenerator().generateForGateway
    GatewayGenerator().generate
    SbtGenerator().generateForGateway
    SbtSettingsGenerator(isGateway = true).generate

    GenericFileGenerator().generateForGateway

  end generateGateway
  

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


end SetupGenerator
