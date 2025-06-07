package orchescala.simulation2

import orchescala.domain
import orchescala.domain.{CamundaVariable, DecisionDmn, ExternalTask, InOut, InOutDecoder, InOutDescr, InOutEncoder, MessageEvent, NoInput, NoOutput, ProcessOrExternalTask, SignalEvent, TimerEvent, UserTask}

import scala.reflect.ClassTag

case class SSimulation(scenarios: List[SScenario[?, ?]])

sealed trait WithTestOverrides[
    In <: Product: {InOutEncoder, InOutDecoder},
    Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
    T <: WithTestOverrides[T, In, Out]
]:
  def inOut: InOut[In, Out, ?]
  def testOverrides: Option[TestOverrides]
  def add(testOverride: TestOverride): T
  
  protected def addOverride(testOverride: TestOverride): Option[TestOverrides] =
    Some(
      testOverrides
        .map(_ :+ testOverride)
        .getOrElse(TestOverrides(Seq(testOverride)))
    )
end WithTestOverrides

sealed trait ScenarioOrStep:
  def name: String
  def typeName: String = getClass.getSimpleName

sealed trait SScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
] extends ScenarioOrStep:
  def inOut: InOut[In, Out, ?]
  def isIgnored: Boolean
  def ignored: SScenario[In, Out]
  def isOnly: Boolean
  def only: SScenario[In, Out]
  def withSteps(steps: List[SStep]): SScenario[In, Out]
end SScenario

sealed trait HasProcessSteps[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}] extends ScenarioOrStep:
  def process: ProcessOrExternalTask[In, Out, ?]
  def steps: List[SStep]

sealed trait IsProcessScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
] extends HasProcessSteps[In, Out], SScenario[In, Out]

case class ProcessScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    // this is name of process in case of START
    // this is message name in case of MESSAGE
    // this is signal name in case of SIGNAL
    name: String,
    process: domain.Process[In, Out, ?],
    steps: List[SStep] = List.empty,
    isIgnored: Boolean = false,
    isOnly: Boolean = false,
    testOverrides: Option[TestOverrides] = None,
    startType: ProcessStartType = ProcessStartType.START
) extends IsProcessScenario[In, Out],
      WithTestOverrides[In, Out, ProcessScenario[In, Out]]:
  def inOut: InOut[?, ?, ?] = process

  def add(testOverride: TestOverride): ProcessScenario[In, Out] =
    copy(testOverrides = addOverride(testOverride))

  def ignored: ProcessScenario[In, Out]                 = copy(isIgnored = true)
  def only: ProcessScenario[In, Out]                    = copy(isOnly = true)
  def withSteps(steps: List[SStep]): SScenario[In, Out] =
    copy(steps = steps)
end ProcessScenario

enum ProcessStartType:
  case START, MESSAGE

case class ExternalTaskScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    name: String,
    process: ExternalTask[In, Out, ?],
    isIgnored: Boolean = false,
    isOnly: Boolean = false,
    testOverrides: Option[TestOverrides] = None,
    startType: ProcessStartType = ProcessStartType.START
) extends IsProcessScenario[In, Out],
      WithTestOverrides[In, Out, ExternalTaskScenario[In, Out]]:

  lazy val steps: List[SStep] = List.empty
  def inOut: InOut[?, ?, ?]   = process

  def add(testOverride: TestOverride): ExternalTaskScenario[In, Out] =
    copy(testOverrides = addOverride(testOverride))

  def ignored: ExternalTaskScenario[In, Out] = copy(isIgnored = true)

  def only: ExternalTaskScenario[In, Out] = copy(isOnly = true)

  def withSteps(steps: List[SStep]): SScenario[In, Out] =
    this

end ExternalTaskScenario

case class DmnScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    name: String,
    inOut: DecisionDmn[?, ?],
    isIgnored: Boolean = false,
    isOnly: Boolean = false,
    testOverrides: Option[TestOverrides] = None
) extends SScenario[In, Out],
      WithTestOverrides[In, Out, DmnScenario[In, Out]]:
  def add(testOverride: TestOverride): DmnScenario[In, Out] =
    copy(testOverrides = addOverride(testOverride))

  def ignored: DmnScenario[In, Out] = copy(isIgnored = true)

  def only: DmnScenario[In, Out] = copy(isOnly = true)

  def withSteps(steps: List[SStep]): SScenario[In, Out] =
    this
end DmnScenario

case class BadScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    name: String,
    process: domain.Process[?, ?, ?],
    status: Int,
    errorMsg: Option[String],
    isIgnored: Boolean = false,
    isOnly: Boolean = false
) extends IsProcessScenario[In, Out]:
  lazy val inOut: domain.Process[?, ?, ?] = process
  lazy val steps: List[SStep]             = List.empty
  def ignored: BadScenario[In, Out]                = copy(isIgnored = true)
  def only: BadScenario[In, Out]                   = copy(isOnly = true)

  def withSteps(steps: List[SStep]): SScenario[In, Out] =
    this
end BadScenario

trait IsIncidentScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
] extends IsProcessScenario[In, Out], HasProcessSteps[In, Out]:
  def incidentMsg: String

case class IncidentScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    name: String,
    process: domain.Process[?, ?, ?],
    steps: List[SStep] = List.empty,
    incidentMsg: String,
    isIgnored: Boolean = false,
    isOnly: Boolean = false
) extends IsIncidentScenario[In, Out],
      HasProcessSteps[In, Out]:
  lazy val inOut: domain.Process[?, ?, ?] = process

  def ignored: IncidentScenario[In, Out] = copy(isIgnored = true)

  def only: IncidentScenario[In, Out] = copy(isOnly = true)

  def withSteps(steps: List[SStep]): SScenario[In, Out] =
    copy(steps = steps)

end IncidentScenario

case class IncidentServiceScenario[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    name: String,
    process: ExternalTask[?, ?, ?],
    incidentMsg: String,
    isIgnored: Boolean = false,
    isOnly: Boolean = false
) extends IsIncidentScenario[In, Out]:
  lazy val inOut: ExternalTask[?, ?, ?] = process
  lazy val steps: List[SStep]           = List.empty

  def ignored: IncidentServiceScenario[In, Out] = copy(isIgnored = true)

  def only: IncidentServiceScenario[In, Out] = copy(isOnly = true)

  def withSteps(steps: List[SStep]): SScenario[In, Out] = this

end IncidentServiceScenario

sealed trait SStep extends ScenarioOrStep

sealed trait SInServiceOuttep[
  In <: Product: {InOutEncoder, InOutDecoder},
]
    extends SStep,
      WithTestOverrides[In, NoOutput, SInServiceOuttep[In]]:
  lazy val inOutDescr: InOutDescr[?, ?]                = inOut.inOutDescr
  lazy val id: String                                  = inOutDescr.id
  lazy val descr: Option[String]                       = inOutDescr.descr
  lazy val camundaInMap: Map[String, CamundaVariable]  = inOut.camundaInMap
  lazy val camundaOutMap: Map[String, CamundaVariable] = inOut.camundaOutMap
end SInServiceOuttep

case class SUserTask[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    name: String,
    inOut: UserTask[?, ?],
    testOverrides: Option[TestOverrides] = None,
    // after getting a task, you can wait - used for intermediate events running something.
    waitForSec: Option[Int] = None
) extends SInServiceOuttep[In]:

  def add(testOverride: TestOverride): SUserTask[In, Out] =
    copy(testOverrides = addOverride(testOverride))
end SUserTask

case class SSubProcess[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](
    name: String,
    process: domain.Process[In, Out, ?],
    steps: List[SStep],
    testOverrides: Option[TestOverrides] = None
) extends SInServiceOuttep[In],
      HasProcessSteps[In, Out]:

  lazy val processName: String            = process.processName
  lazy val inOut: domain.Process[In, Out, ?] = process

  def add(testOverride: TestOverride): SSubProcess[In, Out] =
    copy(testOverrides = addOverride(testOverride))
end SSubProcess

sealed trait SEvent[
  In <: Product: {InOutEncoder, InOutDecoder}
] extends SInServiceOuttep[In]:
  def readyVariable: String
  def readyValue: Any

case class SMessageEvent[
  In <: Product: {InOutEncoder, InOutDecoder},
](
    name: String,
    inOut: MessageEvent[In],
    optReadyVariable: Option[String] = None,
    readyValue: Any = true,
    processInstanceId: Boolean = true,
    testOverrides: Option[TestOverrides] = None
) extends SEvent:
  lazy val readyVariable: String = optReadyVariable.getOrElse(notSet)

  def add(testOverride: TestOverride): SMessageEvent[In] =
    copy(testOverrides = addOverride(testOverride))

  // If you send a Message to start a process, there is no processInstanceId
  def start: SMessageEvent[In] =
    copy(processInstanceId = false)
end SMessageEvent

case class SSignalEvent[
  In <: Product: {InOutEncoder, InOutDecoder}](
    name: String,
    inOut: SignalEvent[?],
    readyVariable: String = "waitForSignal",
    readyValue: Any = true,
    testOverrides: Option[TestOverrides] = None
) extends SEvent:

  def add(testOverride: TestOverride): SSignalEvent[In] =
    copy(testOverrides = addOverride(testOverride))

end SSignalEvent

case class STimerEvent(
    name: String,
    inOut: TimerEvent,
    optReadyVariable: Option[String] = None,
    readyValue: Any = true,
    testOverrides: Option[TestOverrides] = None
) extends SEvent[NoInput]:
  lazy val readyVariable: String = optReadyVariable.getOrElse(notSet)

  def add(testOverride: TestOverride): STimerEvent =
    copy(testOverrides = addOverride(testOverride))

end STimerEvent

case class SWaitTime(seconds: Int = 5) extends SStep:
  val name: String = s"Wait for $seconds seconds"

lazy val notSet = "NotSet"
