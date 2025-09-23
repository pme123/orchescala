package orchescala.simulation

import orchescala.domain
import orchescala.domain.*

case class SSimulation(scenarios: List[SScenario])

sealed trait WithTestOverrides[T <: WithTestOverrides[T]]:
  def inOut: InOut[?, ?, ?]
  def testOverrides: Option[TestOverrides]
  def add(testOverride: TestOverride): T
  protected def addOverride(testOverride: TestOverride): Option[TestOverrides] =
    Some(
      testOverrides
        .map(_ :+ testOverride)
        .getOrElse(TestOverrides(Seq(testOverride)))
    )
  lazy val camundaToCheckMap: Map[String, CamundaVariable]                     =
    inOut.camundaToCheckMap
end WithTestOverrides

sealed trait ScenarioOrStep:
  def inOutId: String
  def scenarioName: String
  def typeName: String = getClass.getSimpleName

  lazy val name: String =
    if scenarioName.contains("$proxy") then
      inOutId
    else
      scenarioName
end ScenarioOrStep

sealed trait SScenario extends ScenarioOrStep:
  def inOut: InOut[?, ?, ?]
  lazy val inOutId: String = inOut.id
  def isIgnored: Boolean
  def ignored: SScenario
  def isOnly: Boolean
  def only: SScenario
  def withSteps(steps: List[SStep]): SScenario
end SScenario

sealed trait HasProcessSteps extends ScenarioOrStep:
  def process: ProcessOrExternalTask[?, ?, ?]
  def steps: List[SStep]

sealed trait IsProcessScenario extends HasProcessSteps, SScenario

case class ProcessScenario(
    // this is name of process in case of START
    // this is message name in case of MESSAGE
    // this is signal name in case of SIGNAL
    scenarioName: String,
    process: domain.Process[?, ?, ?],
    steps: List[SStep] = List.empty,
    isIgnored: Boolean = false,
    isOnly: Boolean = false,
    testOverrides: Option[TestOverrides] = None,
    startType: ProcessStartType = ProcessStartType.START
) extends IsProcessScenario,
      WithTestOverrides[ProcessScenario]:
  def inOut: InOut[?, ?, ?] = process

  def add(testOverride: TestOverride): ProcessScenario =
    copy(testOverrides = addOverride(testOverride))

  def ignored: ProcessScenario                 = copy(isIgnored = true)
  def only: ProcessScenario                    = copy(isOnly = true)
  def withSteps(steps: List[SStep]): SScenario =
    copy(steps = steps)
end ProcessScenario

enum ProcessStartType:
  case START, MESSAGE

case class BadScenario(
    scenarioName: String,
    process: domain.Process[?, ?, ?],
    errorMsg: String,
    isIgnored: Boolean = false,
    isOnly: Boolean = false
) extends IsProcessScenario:
  lazy val inOut: domain.Process[?, ?, ?] = process
  lazy val steps: List[SStep]             = List.empty
  def ignored: BadScenario                = copy(isIgnored = true)
  def only: BadScenario                   = copy(isOnly = true)

  def withSteps(steps: List[SStep]): SScenario =
    this
end BadScenario

case class IncidentScenario(
    scenarioName: String,
    process: domain.Process[?, ?, ?],
    steps: List[SStep] = List.empty,
    incidentMsg: String,
    isIgnored: Boolean = false,
    isOnly: Boolean = false,
    startType: ProcessStartType = ProcessStartType.START
) extends IsProcessScenario,
      HasProcessSteps:
  lazy val inOut: domain.Process[?, ?, ?] = process

  def ignored: IncidentScenario = copy(isIgnored = true)

  def only: IncidentScenario = copy(isOnly = true)

  def withSteps(steps: List[SStep]): SScenario =
    copy(steps = steps)

end IncidentScenario

sealed trait SStep extends ScenarioOrStep

sealed trait SInOutServiceStep
    extends SStep,
      WithTestOverrides[SInOutServiceStep]:
  lazy val inOutDescr: InOutDescr[?, ?]                = inOut.inOutDescr
  lazy val inOutId: String                             = inOut.id
  lazy val id: String                                  = inOutDescr.id
  lazy val descr: Option[String]                       = inOutDescr.descr
  lazy val camundaInMap: Map[String, CamundaVariable]  = inOut.camundaInMap
  lazy val camundaOutMap: Map[String, CamundaVariable] = inOut.camundaOutMap
end SInOutServiceStep

case class SUserTask(
    scenarioName: String,
    inOut: UserTask[?, ?],
    testOverrides: Option[TestOverrides] = None,
    // after getting a task, you can wait - used for intermediate events running something.
    waitForSec: Option[Int] = None
) extends SInOutServiceStep:

  def add(testOverride: TestOverride): SUserTask =
    copy(testOverrides = addOverride(testOverride))
end SUserTask

sealed trait SEvent extends SInOutServiceStep:
  def readyVariable: String
  def readyValue: Any
end SEvent

case class SMessageEvent(
    scenarioName: String,
    inOut: MessageEvent[?],
    optReadyVariable: Option[String] = None,
    readyValue: Any = true,
    processInstanceId: Boolean = true,
    testOverrides: Option[TestOverrides] = None,
    businessKey: Option[String] = None
) extends SEvent:

  lazy val readyVariable: String = optReadyVariable.getOrElse(notSet)

  def add(testOverride: TestOverride): SMessageEvent =
    copy(testOverrides = addOverride(testOverride))

  // If you send a Message to start a process, there is no processInstanceId
  def start: SMessageEvent =
    copy(processInstanceId = false)

  def withBusinessKey(businessKey: String): SMessageEvent =
    copy(businessKey = Some(businessKey))
end SMessageEvent

case class SSignalEvent(
    scenarioName: String,
    inOut: SignalEvent[?],
    readyVariable: String = "waitForSignal",
    readyValue: Any = true,
    testOverrides: Option[TestOverrides] = None
) extends SEvent:

  def add(testOverride: TestOverride): SSignalEvent =
    copy(testOverrides = addOverride(testOverride))

end SSignalEvent

case class STimerEvent(
    scenarioName: String,
    inOut: TimerEvent,
    optReadyVariable: Option[String] = None,
    readyValue: Any = true,
    testOverrides: Option[TestOverrides] = None
) extends SEvent:
  lazy val readyVariable: String = optReadyVariable.getOrElse(notSet)

  def add(testOverride: TestOverride): STimerEvent =
    copy(testOverrides = addOverride(testOverride))

end STimerEvent

case class SWaitTime(seconds: Int = 5) extends SStep:

  lazy val scenarioName: String = s"Wait for $seconds seconds"
  lazy val inOutId: String      = scenarioName

lazy val notSet = "NotSet"
