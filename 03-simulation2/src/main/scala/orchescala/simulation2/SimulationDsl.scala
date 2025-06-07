package orchescala.simulation2

import orchescala.domain.*

import scala.reflect.ClassTag

trait SimulationDsl[T]:

  protected def run(sim: SSimulation): T

  inline def simulate(body: => (Seq[SScenario[?, ?]] | SScenario[?, ?])*): Unit =
    try
      val scenarios = body.flatMap:
        case s: Seq[?]          => s.collect { case ss: SScenario[?, ?] => ss }
        case s: SScenario[?, ?] => Seq(s)

      val modScen =
        if scenarios.exists(_.isOnly)
        then
          scenarios.map:
            case s if s.isOnly => s
            case s             => s.ignored
        else scenarios

      run(SSimulation(modScen.toList)) // runs Scenarios
    catch
      case err => // there could be errors in the creation of the SScenarios
        err.printStackTrace()

  def scenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](scen: ProcessScenario[In, Out]): SScenario[In, Out] =
    scenario(scen)()

  def scenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](scen: ExternalTaskScenario[In, Out]): SScenario[In, Out] =
    scen

  inline def serviceScenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
      ServiceIn: {InOutEncoder, InOutDecoder},
      ServiceOut: {InOutEncoder, InOutDecoder}
  ](
      task: ServiceTask[In, Out, ServiceIn, ServiceOut],
      outputMock: Out,
      outputServiceMock: MockedServiceResponse[ServiceOut]
  ): Seq[ExternalTaskScenario[In, Out]] =
    val withDefaultMock       = task.mockServicesWithDefault
    val withOutputMock        = task
      .mockWith(outputMock)
      .withOut(outputMock)
    val withServiceOutputMock = task
      .mockServiceWith(outputServiceMock)
      .withOut(outputMock)

    Seq(
      ExternalTaskScenario(nameOfVariable(task) + " defaultMock", withDefaultMock),
      ExternalTaskScenario(nameOfVariable(task) + " outputMock", withOutputMock),
      ExternalTaskScenario(nameOfVariable(task) + " outputServiceMock", withServiceOutputMock)
    )
  end serviceScenario

  inline def serviceScenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
      ServiceIn: {InOutEncoder, InOutDecoder},
      ServiceOut: {InOutEncoder, InOutDecoder}
  ](
      task: ServiceTask[In, Out, ServiceIn, ServiceOut],
      outputMock: Out,
      outputServiceMock: ServiceOut,
      respHeaders: Map[String, String] = Map.empty
  ): Seq[ExternalTaskScenario[In, Out]] =
    serviceScenario(
      task,
      outputMock,
      MockedServiceResponse.success200(outputServiceMock).withHeaders(respHeaders)
    )

  inline def serviceScenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
      ServiceIn: {InOutEncoder, InOutDecoder},
      ServiceOut: {InOutEncoder, InOutDecoder}
  ](
      task: ServiceTask[In, Out, ServiceIn, ServiceOut]
  ): Seq[ExternalTaskScenario[In, Out]] =
    serviceScenario(task, task.out, task.defaultServiceOutMock)

  def scenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](scen: DmnScenario[In, Out]): SScenario[In, Out] =
    scen

  def scenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](scen: ProcessScenario[In, Out])(body: SStep*): SScenario[In, Out] =
    scen.withSteps(body.toList)

  inline def badScenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](
      inline process: Process[In, Out, ?],
      status: Int,
      errorMsg: Optable[String] = None
  ): BadScenario[In, Out] =
    BadScenario(nameOfVariable(process), process, status, errorMsg.value)

  inline def incidentScenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](
      inline process: Process[In, Out, ?],
      incidentMsg: String
  )(body: SStep*): IncidentScenario[In, Out] =
    IncidentScenario(nameOfVariable(process), process, body.toList, incidentMsg)

  inline def incidentScenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](
      inline process: Process[In, Out, ?],
      incidentMsg: String
  ): IncidentScenario[In, Out] =
    incidentScenario(process, incidentMsg)()

  inline def incidentScenario[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](
      inline process: ExternalTask[?, ?, ?],
      incidentMsg: String
  ): IncidentServiceScenario[In, Out] =
    IncidentServiceScenario(nameOfVariable(process), process, incidentMsg)

  inline def subProcess[
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](inline process: Process[In, Out, ?])(
      body: SStep*
  ): SSubProcess[In, Out] =
    SSubProcess(nameOfVariable(process), process, body.toList)

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[Process[In, Out, ?], ProcessScenario[In, Out]] with
    inline def apply(process: Process[In, Out, ?]): ProcessScenario[In, Out] =
      ProcessScenario(nameOfVariable(process), process)
  end given

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[ServiceTask[In, Out, ?, ?], ExternalTaskScenario[In, Out]] with
    inline def apply(task: ServiceTask[In, Out, ?, ?]): ExternalTaskScenario[In, Out] =
      ExternalTaskScenario(nameOfVariable(task), task)
  end given

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[CustomTask[In, Out], ExternalTaskScenario[In, Out]] with
    inline def apply(task: CustomTask[In, Out]): ExternalTaskScenario[In, Out] =
      ExternalTaskScenario(nameOfVariable(task), task)
  end given

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[DecisionDmn[In, Out], DmnScenario[In, Out]] with
    inline def apply(task: DecisionDmn[In, Out]): DmnScenario[In, Out] =
      DmnScenario(nameOfVariable(task), task)
  end given

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[UserTask[In, Out], SUserTask[In, Out]] with
    inline def apply(task: UserTask[In, Out]): SUserTask[In, Out] =
      SUserTask(nameOfVariable(task), task)
  end given

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[MessageEvent[In], SMessageEvent[In]] with
    inline def apply(event: MessageEvent[In]): SMessageEvent[In] =
      SMessageEvent(nameOfVariable(event), event)
  end given

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[SignalEvent[In], SSignalEvent[In]] with
    inline def apply(event: SignalEvent[In]): SSignalEvent[In] =
      SSignalEvent(nameOfVariable(event), event)
  end given

  inline given [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ]: Conversion[TimerEvent, STimerEvent] with
    inline def apply(event: TimerEvent): STimerEvent =
      STimerEvent(nameOfVariable(event), event)
  end given

  extension [
      In <: Product: {InOutEncoder, InOutDecoder}
  ](event: MessageEvent[In])
    def waitFor(readyVariable: String): SMessageEvent[In]                  =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any): SMessageEvent[In] =
      SMessageEvent(event.messageName, event, Some(readyVariable), readyValue)
    def start: SMessageEvent[In]                                           =
      SMessageEvent(event.messageName, event).start
  end extension

  extension [In <: Product: {InOutEncoder, InOutDecoder}](event: SignalEvent[In])
    def waitFor(readyVariable: String): SSignalEvent[In]                         =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any = true): SSignalEvent[In] =
      SSignalEvent(event.messageName, event, readyVariable, readyValue)
  end extension

  extension (event: TimerEvent)
    def waitFor(readyVariable: String): STimerEvent                  =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any): STimerEvent =
      STimerEvent(event.title, event, Some(readyVariable), readyValue)
  end extension

  extension [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](ut: UserTask[In, Out])
    def waitForSec(sec: Int): SUserTask[In, Out] =
      SUserTask(ut.name, ut, waitForSec = Some(sec))

  end extension

  def waitFor(timeInSec: Int): SWaitTime = SWaitTime(timeInSec)

  extension [
      In <: Product: {InOutEncoder, InOutDecoder},
      Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
  ](scen: ProcessScenario[In, Out])
    def startWithMsg: ProcessScenario[In, Out] =
      scen.copy(startType = ProcessStartType.MESSAGE)

  end extension

  object ignore:

    def simulate(body: SScenario[?, ?]*): T =
      run(SSimulation(body.map(_.ignored).toList))

    def scenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](scen: SScenario[In, Out]): SScenario[In, Out] =
      scen.ignored

    def scenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](scen: SScenario[In, Out])(body: SStep*): SScenario[In, Out] =
      scen.ignored.withSteps(body.toList)

    inline def serviceScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
        ServiceIn: {InOutEncoder, InOutDecoder},
        ServiceOut: {InOutEncoder, InOutDecoder}
    ](
        task: ServiceTask[In, Out, ServiceIn, ServiceOut],
        outputMock: Out,
        outputServiceMock: MockedServiceResponse[ServiceOut]
    ): Seq[ExternalTaskScenario[In, Out]] =
      Seq(ExternalTaskScenario(nameOfVariable(task) + " defaultMock", task).ignored)

    inline def serviceScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
        ServiceIn: {InOutEncoder, InOutDecoder},
        ServiceOut: {InOutEncoder, InOutDecoder}
    ](
        task: ServiceTask[In, Out, ServiceIn, ServiceOut],
        outputMock: Out,
        outputServiceMock: ServiceOut,
        respHeaders: Map[String, String] = Map.empty
    ): Seq[ExternalTaskScenario[In, Out]] =
      serviceScenario(
        task,
        outputMock,
        MockedServiceResponse.success200(outputServiceMock).withHeaders(respHeaders)
      )

    inline def serviceScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
        ServiceIn: {InOutEncoder, InOutDecoder},
        ServiceOut: {InOutEncoder, InOutDecoder}
    ](
        task: ServiceTask[In, Out, ServiceIn, ServiceOut]
    ): Seq[ExternalTaskScenario[In, Out]] =
      serviceScenario(task, task.out, task.defaultServiceOutMock)

    def badScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](
        scen: SScenario[In, Out],
        status: Int,
        errorMsg: Optable[String] = None
    ): SScenario[In, Out] =
      scen.ignored

    def incidentScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](scen: SScenario[In, Out], incidentMsg: String): SScenario[In, Out] =
      scen.ignored

    def incidentScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](scen: SScenario[In, Out], incidentMsg: String)(
        body: SStep*
    ): SScenario[In, Out] =
      scen.ignored
  end ignore

  object only:

    def scenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](scen: SScenario[In, Out]): SScenario[In, Out] =
      scen.only

    def scenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](scen: SScenario[In, Out])(body: SStep*): SScenario[In, Out] =
      scen.only.withSteps(body.toList)

    inline def serviceScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
        ServiceIn: {InOutEncoder, InOutDecoder},
        ServiceOut: {InOutEncoder, InOutDecoder}
    ](
        task: ServiceTask[In, Out, ServiceIn, ServiceOut],
        outputMock: Out,
        outputServiceMock: MockedServiceResponse[ServiceOut]
    ): Seq[ExternalTaskScenario[In, Out]] =
      Seq(ExternalTaskScenario(nameOfVariable(task) + " defaultMock", task).only)

    inline def serviceScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
        ServiceIn: {InOutEncoder, InOutDecoder},
        ServiceOut: {InOutEncoder, InOutDecoder}
    ](
        task: ServiceTask[In, Out, ServiceIn, ServiceOut],
        outputMock: Out,
        outputServiceMock: ServiceOut,
        respHeaders: Map[String, String] = Map.empty
    ): Seq[ExternalTaskScenario[In, Out]] =
      serviceScenario(
        task,
        outputMock,
        MockedServiceResponse.success200(outputServiceMock).withHeaders(respHeaders)
      )

    inline def serviceScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
        ServiceIn: {InOutEncoder, InOutDecoder},
        ServiceOut: {InOutEncoder, InOutDecoder}
    ](
        task: ServiceTask[In, Out, ServiceIn, ServiceOut]
    ): Seq[ExternalTaskScenario[In, Out]] =
      serviceScenario(task, task.out, task.defaultServiceOutMock)

    inline def badScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](
        inline process: Process[In, Out, ?],
        status: Int,
        errorMsg: Optable[String] = None
    ): BadScenario[In, Out] =
      BadScenario(nameOfVariable(process), process, status, errorMsg.value, isOnly = true)

    inline def incidentScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](
        inline process: Process[In, Out, ?],
        incidentMsg: String
    )(body: SStep*): IncidentScenario[In, Out] =
      IncidentScenario(nameOfVariable(process), process, body.toList, incidentMsg, isOnly = true)

    inline def incidentScenario[
        In <: Product: {InOutEncoder, InOutDecoder},
        Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
    ](
        inline process: Process[In, Out, ?],
        incidentMsg: String
    ): IncidentScenario[In, Out] =
      incidentScenario(process, incidentMsg)()
  end only

end SimulationDsl
