package orchescala.simulation2

import orchescala.domain.*

trait SimulationDsl[T] extends TestOverrideExtensions:

  protected def run(sim: SSimulation): T

  def simulate(body: => (Seq[SScenario] | SScenario)*): Unit = {
    println("simulate started!")
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

  extension (event: MessageEvent[?])
    def waitFor(readyVariable: String): SMessageEvent =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any): SMessageEvent =
      SMessageEvent(event.name, event, Some(readyVariable), readyValue)
    def start: SMessageEvent =
      SMessageEvent(event.name, event).start
  end extension

  extension (event: SignalEvent[?])
    def waitFor(readyVariable: String): SSignalEvent =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any = true): SSignalEvent =
      SSignalEvent(event.name, event, readyVariable, readyValue)
  end extension

  extension (event: TimerEvent)
    def waitFor(readyVariable: String): STimerEvent =
      event.waitFor(readyVariable, true)
    def waitFor(readyVariable: String, readyValue: Any): STimerEvent =
      STimerEvent(event.name, event, Some(readyVariable), readyValue)
  end extension

  extension (ut: UserTask[?, ?])
    def waitForSec(sec: Int): SUserTask =
      SUserTask(ut.name, ut, waitForSec = Some(sec))

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
