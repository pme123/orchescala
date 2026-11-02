package orchescala.simulation

import orchescala.domain.*
import scala.language.implicitConversions
trait SimulationDsl[T] extends TestOverrideExtensions:

  protected def run(sim: SSimulation): T

  def simulate(body: => (Seq[SScenario] | SScenario)*): Unit = {
    try
      val scenarios = body.flatMap:
        case s: Seq[?] => s.collect { case ss: SScenario => ss }
        case s: SScenario => Seq(s)

      val modScen =
        if scenarios.exists(_.isOnly)
        then
          scenarios.map:
            case s if s.isOnly => s
            case s => s.ignored
        else scenarios

      run(SSimulation(modScen.toList)) // runs Scenarios
    catch
      case err => // there could be errors in the creation of the SScenarios
        err.printStackTrace()
  }

  def scenario(scen: ProcessScenario): SScenario =
    scenario(scen)()
  
  def scenario(scen: ProcessScenario)(body: SStep*): SScenario =
    scen.withSteps(body.toList)

  inline def badScenario(
      inline process: Process[?, ?, ?],
      errorMsg: String
  ): BadScenario =
    BadScenario(nameOfVariable(process), process, errorMsg)

  inline def incidentScenario(
      inline process: Process[?, ?, ?],
      incidentMsg: String
  )(body: SStep*): IncidentScenario =
    IncidentScenario(nameOfVariable(process), process, body.toList, incidentMsg)

  inline def incidentScenario(
      inline process: Process[?, ?, ?],
      incidentMsg: String
  ): IncidentScenario =
    incidentScenario(process, incidentMsg)()
  
  inline given Conversion[Process[?, ?, ?], ProcessScenario] with
    inline def apply(process: Process[?, ?, ?]): ProcessScenario =
      ProcessScenario(nameOfVariable(process), process)
  
  // A check on a process makes it a scenario named after the val it is defined in - not after
  // `example` (the conversion above would take the name of the process value):
  // `lazy val Approved = example.exists("x")` -> scenario `Approved`.
  extension (inline process: Process[?, ?, ?])
    inline def exists(key: String): ProcessScenario =
      ProcessScenario(nameOfEnclosingVal(process), process).exists(key)
    inline def notExists(key: String): ProcessScenario =
      ProcessScenario(nameOfEnclosingVal(process), process).notExists(key)
    inline def isEquals[V: InOutEncoder](key: String, value: V): ProcessScenario =
      ProcessScenario(nameOfEnclosingVal(process), process).isEquals(key, value)
    inline def hasSize(key: String, size: Int): ProcessScenario =
      ProcessScenario(nameOfEnclosingVal(process), process).hasSize(key, size)
    inline def hasSize(size: Int): ProcessScenario =
      ProcessScenario(nameOfEnclosingVal(process), process).hasSize(size)
    inline def contains(key: String, value: CamundaVariable): ProcessScenario =
      ProcessScenario(nameOfEnclosingVal(process), process).contains(key, value)
    inline def contains[V: InOutEncoder](expected: V): ProcessScenario =
      ProcessScenario(nameOfEnclosingVal(process), process).contains(expected)
  end extension

  // Acting as another identity names the step after the val it is defined in, like the checks
  // on a process: `lazy val CloseUT = CloseRequestUT.example.actingAs(testActorIdentityCorrelation)`.
  extension (inline task: UserTask[?, ?])
    inline def actingAs(identity: IdentityCorrelation): SUserTask =
      SUserTask(nameOfEnclosingVal(task), task).actingAs(identity)

  extension (inline event: MessageEvent[?])
    inline def actingAs(identity: IdentityCorrelation): SMessageEvent =
      SMessageEvent(nameOfEnclosingVal(event), event).actingAs(identity)

  inline given Conversion[UserTask[?, ?], SUserTask] with
    inline def apply(task: UserTask[?, ?]): SUserTask =
      SUserTask(nameOfVariable(task), task)

  inline given Conversion[MessageEvent[?], SMessageEvent] with
    inline def apply(event: MessageEvent[?]): SMessageEvent =
      SMessageEvent(nameOfVariable(event), event)

  inline given Conversion[SignalEvent[?], SSignalEvent] with
    inline def apply(event: SignalEvent[?]): SSignalEvent =
      SSignalEvent(nameOfVariable(event), event)

  inline given Conversion[TimerEvent, STimerEvent] with
    inline def apply(event: TimerEvent): STimerEvent =
      STimerEvent(nameOfVariable(event), event)

  extension (event: SMessageEvent)
    def waitFor(readyVariable: String): SMessageEvent =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any): SMessageEvent =
      event.copy(scenarioName = event.name, optReadyVariable = Some(readyVariable), readyValue = readyValue)

  end extension

  extension (event: SSignalEvent)
    def waitFor(readyVariable: String): SSignalEvent =
      event.waitFor(readyVariable, true)

    def waitFor(readyVariable: String, readyValue: Any): SSignalEvent =
      event.copy(readyVariable = readyVariable, readyValue = readyValue)
  end extension

  extension (event: STimerEvent)
    def waitFor(readyVariable: String): STimerEvent =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any): STimerEvent =
      event.copy(optReadyVariable = Some(readyVariable), readyValue = readyValue)
  end extension

  extension (ut: SUserTask)
    def waitForSec(sec: Int): SUserTask =
      ut.copy(waitForSec = Some(sec))

  end extension

  def waitFor(timeInSec: Int): SWaitTime = SWaitTime(timeInSec)

  extension (scen: ProcessScenario)
    def startWithMsg: ProcessScenario =
      scen.copy(startType = ProcessStartType.MESSAGE)
  end extension

  extension (scen: IncidentScenario)
    def startWithMsg: IncidentScenario =
      scen.copy(startType = ProcessStartType.MESSAGE)
  end extension

  object ignore:

    def simulate(body: SScenario*): T =
      run(SSimulation(body.map(_.ignored).toList))

    def scenario(scen: SScenario): SScenario =
      scen.ignored

    def scenario(scen: SScenario)(body: SStep*): SScenario =
      scen.ignored.withSteps(body.toList)
    
    def badScenario(
        scen: SScenario,
        status: Int,
        errorMsg: Optable[String] = None
    ): SScenario =
      scen.ignored

    def incidentScenario(scen: SScenario, incidentMsg: String): SScenario =
      scen.ignored

    def incidentScenario(scen: SScenario, incidentMsg: String)(
        body: SStep*
    ): SScenario =
      scen.ignored
  end ignore

  object only:

    def scenario(scen: SScenario): SScenario =
      scen.only

    def scenario(scen: SScenario)(body: SStep*): SScenario =
      scen.only.withSteps(body.toList)
    
    inline def badScenario(
                            inline process: Process[?, ?, ?],
                            errorMsg: String
                          ): BadScenario =
      BadScenario(nameOfVariable(process), process, errorMsg, isOnly = true)

    inline def incidentScenario(
                                 inline process: Process[?, ?, ?],
                                 incidentMsg: String
                               )(body: SStep*): IncidentScenario =
      IncidentScenario(nameOfVariable(process), process, body.toList, incidentMsg, isOnly = true)

    inline def incidentScenario(
                                 inline process: Process[?, ?, ?],
                                 incidentMsg: String
                               ): IncidentScenario =
      incidentScenario(process, incidentMsg)()
  end only

end SimulationDsl
