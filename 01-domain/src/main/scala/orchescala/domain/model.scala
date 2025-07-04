package orchescala.domain

import orchescala.domain.*

import java.time.{LocalDate, LocalDateTime, ZonedDateTime}

case class InOutDescr[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema}
](
    id: String,
    in: In = NoInput(),
    out: Out = NoOutput(),
    descr: Option[String] = None
):
  lazy val niceName: String =
    id.split("-")
      .map: p =>
        p.head.toUpper + p.tail
      .mkString(" ")
  end niceName

  lazy val shortName: String = shortenName(id)

end InOutDescr

trait Activity[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema},
    T <: InOut[In, Out, T]
] extends InOut[In, Out, T]

enum InOutType:
  case Bpmn, Dmn, Worker, Timer, Signal, Message, UserTask

trait InOut[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema},
    T <: InOut[In, Out, T]
] extends ProcessElement:
  def inOutDescr: InOutDescr[In, Out]
  // def constructor: InOutDescr[In, Out] => T
  def inOutType: InOutType
  def otherEnumInExamples: Option[Seq[In]]
  def otherEnumOutExamples: Option[Seq[Out]]

  lazy val id: String            = inOutDescr.id
  lazy val descr: Option[String] = inOutDescr.descr
  lazy val in: In                = inOutDescr.in
  lazy val out: Out              = inOutDescr.out
  lazy val niceName: String      = inOutDescr.niceName
  lazy val outAsJson: Json       = out.asJson.deepDropNullValues
  lazy val inAsJson: Json        = in.asJson.deepDropNullValues

  def camundaInMap: Map[String, CamundaVariable] =
    CamundaVariable.toCamunda(in)

  lazy val camundaOutMap: Map[String, CamundaVariable] =
    CamundaVariable.toCamunda(out)
  def camundaToCheckMap: Map[String, CamundaVariable]  =
    camundaOutMap.filterNot(_._1 == "type") // type used for Sum types - cannot be tested

  def withInOutDescr(inOutDescr: InOutDescr[In, Out]): T

  def withId(i: String): T =
    withInOutDescr(inOutDescr.copy(id = i))

  def withDescr(description: String): T =
    withInOutDescr(inOutDescr.copy(descr = Some(description)))

  def withIn(in: In): T =
    withInOutDescr(inOutDescr.copy(in = in))

  // this allows you to manipulate the existing in directly
  def withIn(inFunct: In => In): T =
    withInOutDescr(inOutDescr.copy(in = inFunct(in)))

  def withOut(out: Out): T =
    withInOutDescr(
      inOutDescr.copy(out = out)
    )

  // this allows you to manipulate the existing out directly
  def withOut(outFunct: Out => Out): T =
    withInOutDescr(inOutDescr.copy(out = outFunct(out)))

  lazy val inVariableNames: Seq[String] =
    inOutVariableNames(in, otherEnumInExamples)

  lazy val outVariableNames: Seq[String] =
    inOutVariableNames(out, otherEnumOutExamples)

  lazy val inVariables: Seq[(String, Any)] =
    inOutVariables(in, otherEnumInExamples)

  lazy val outVariables: Seq[(String, Any)] =
    inOutVariables(out, otherEnumOutExamples)

  private def inOutVariableNames(inOut: Product, otherEnumExamples: Option[Seq[Product]]) =
    (inOut.productElementNames.toSeq ++
      otherEnumExamples
        .map:
          _.flatMap(_.productElementNames)
        .toSeq.flatten)
      .distinct

  private def inOutVariables(inOut: Product, otherEnumExamples: Option[Seq[Product]]) =
    (inOut.productElementNames.toSeq
      .zip(inOut.productIterator) ++
      otherEnumExamples
        .map:
          _.flatMap: i =>
            i.productElementNames.toSeq
              .zip(i.productIterator)
        .toSeq.flatten)
      .distinct
      .foldLeft(Seq.empty[(String, Any)]): (acc, el) =>
        if acc.exists(_._1 == el._1) then acc
        else acc :+ el
end InOut

trait ProcessElement extends Product:
  def id: String
  def typeName: String = getClass.getSimpleName
  def label: String    = typeName.head.toString.toLowerCase + typeName.tail
  def descr: Option[String]
end ProcessElement

trait ProcessNode extends ProcessElement

sealed trait ProcessOrExternalTask[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema},
    T <: InOut[In, Out, T]
] extends InOut[In, Out, T]:
  def processName: String

  def topicName: String = processName

  def dynamicOutMock: Option[In => Out]

  protected def mockedWorkers: Seq[String]
  protected def servicesMocked: Boolean
  protected def outputMock: Option[Out]
  protected def impersonateUserId: Option[String]

  override def camundaInMap: Map[String, CamundaVariable] =
    val camundaOutputMock: Map[String, CamundaVariable] = outputMock
      .map(m =>
        InputParams.outputMock.toString -> CamundaVariable.valueToCamunda(
          m.asJson.deepDropNullValues
        )
      )
      .toMap

    val camundaServicesMocked: (String, CamundaVariable) =
      InputParams.servicesMocked.toString -> CamundaVariable.valueToCamunda(
        servicesMocked
      )
    val camundaImpersonateUserId = impersonateUserId.toSeq.map { uiId =>
      InputParams.impersonateUserId.toString -> CamundaVariable.valueToCamunda(uiId)
    }.toMap
    super.camundaInMap ++ camundaImpersonateUserId ++ camundaOutputMock + camundaServicesMocked
  end camundaInMap

  def camundaInBody: Json =
    Json.obj(
      (InputParams.outputMock.toString, outputMock.map(_.asJson).getOrElse(Json.Null)),
      (InputParams.servicesMocked.toString, servicesMocked.asJson),
      (InputParams.mockedWorkers.toString, mockedWorkers.asJson.deepDropNullValues),
      (InputParams.impersonateUserId.toString, impersonateUserId.map(_.asJson).getOrElse(Json.Null))
    ).deepMerge(inAsJson)
      .deepDropNullValues
  end camundaInBody

end ProcessOrExternalTask

case class Process[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema},
    InitIn <: Product: {InOutEncoder, Schema}
](
    inOutDescr: InOutDescr[In, Out],
    initIn: InitIn = NoInput(),
    processLabels: ProcessLabels,
    protected val elements: Seq[ProcessNode | InOut[?, ?, ?]] = Seq.empty,
    startEventType: StartEventType = StartEventType.None,
    otherEnumInExamples: Option[Seq[In]] = None,
    otherEnumOutExamples: Option[Seq[Out]] = None,
    initInDescr: Option[String] = None,
    dynamicOutMock: Option[In => Out] = None,
    protected val servicesMocked: Boolean = false,
    protected val mockedWorkers: Seq[String] = Seq.empty,
    protected val outputMock: Option[Out] = None,
    protected val impersonateUserId: Option[String] = None
) extends ProcessOrExternalTask[In, Out, Process[In, Out, InitIn]]:
  lazy val inOutType: InOutType = InOutType.Bpmn

  lazy val processName = inOutDescr.id

  def inOuts: Seq[InOut[?, ?, ?]] = elements.collect { case io: InOut[?, ?, ?] =>
    io
  }

  def withInOutDescr(descr: InOutDescr[In, Out]): Process[In, Out, InitIn] =
    copy(inOutDescr = descr)

  def withElements(elements: (ProcessNode | InOut[?, ?, ?])*): Process[In, Out, InitIn] =
    this.copy(elements = elements)

  def withImpersonateUserId(impersonateUserId: String): Process[In, Out, InitIn] =
    copy(impersonateUserId = Some(impersonateUserId))

  def withStartEventType(startEventType: StartEventType): Process[In, Out, InitIn] =
    copy(startEventType = startEventType)

  def mockServices: Process[In, Out, InitIn] =
    copy(servicesMocked = true)

  def mockWith(outputMock: Out): Process[In, Out, InitIn] =
    copy(outputMock = Some(outputMock))

  def mockWith(outputMock: In => Out): Process[In, Out, InitIn] =
    copy(dynamicOutMock = Some(outputMock))

  def mockWorkers(workerNames: String*): Process[In, Out, InitIn] =
    copy(mockedWorkers = workerNames)

  def mockWorker(workerName: String): Process[In, Out, InitIn] =
    copy(mockedWorkers = mockedWorkers :+ workerName)

  def withEnumInExample(
      enumInExample: In
  ): Process[In, Out, InitIn] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) :+ enumInExample)
    )

  def withEnumOutExample(
      enumOutExample: Out
  ): Process[In, Out, InitIn] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) :+ enumOutExample)
    )

  def withEnumInExamples(
      enumInExamples: In*
  ): Process[In, Out, InitIn] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) ++ enumInExamples)
    )

  def withEnumOutExamples(
      enumOutExamples: Out*
  ): Process[In, Out, InitIn] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) ++ enumOutExamples)
    )

  def withInitInDescr(
      descr: String
  ): Process[In, Out, InitIn] =
    copy(initInDescr = Some(descr))

  override def camundaInMap: Map[String, CamundaVariable] =
    val camundaMockedWorkers =
      InputParams.mockedWorkers.toString -> CamundaVariable.valueToCamunda(
        mockedWorkers.asJson.deepDropNullValues
      )

    super.camundaInMap + camundaMockedWorkers
  end camundaInMap

end Process

enum StartEventType:
  case None, Message, Signal

object StartEventType:
  given InOutCodec[StartEventType] = deriveCodec
  given ApiSchema[StartEventType]  = deriveApiSchema

sealed trait ExternalTask[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema},
    T <: ExternalTask[In, Out, T]
] extends ProcessOrExternalTask[In, Out, T]:
  override final def topicName: String     = inOutDescr.id
  protected def manualOutMapping: Boolean
  protected def outputVariables: Seq[String]
  protected def handledErrors: Seq[ErrorCodeType]
  protected def regexHandledErrors: Seq[String]
  protected def mockedWorkers: Seq[String] = Seq.empty
  lazy val inOutType: InOutType            = InOutType.Worker

  def processName: String = GenericExternalTaskProcessName

  override def camundaInMap: Map[String, CamundaVariable]      =
    super.camundaInMap +
      (InputParams.handledErrors.toString      -> CamundaVariable.valueToCamunda(
        handledErrors.map(_.toString).asJson.deepDropNullValues
      )) +
      (InputParams.regexHandledErrors.toString -> CamundaVariable
        .valueToCamunda(regexHandledErrors.asJson.deepDropNullValues)) +
      (InputParams.topicName.toString          -> CamundaVariable
        .valueToCamunda(topicName)) +
      (InputParams.manualOutMapping.toString   -> CamundaVariable
        .valueToCamunda(manualOutMapping)) +
      (InputParams.outputVariables.toString    -> CamundaVariable
        .valueToCamunda(outputVariables.asJson.deepDropNullValues))
end ExternalTask

case class ServiceTask[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema},
    ServiceIn: {InOutEncoder, InOutDecoder},
    ServiceOut: {InOutEncoder, InOutDecoder}
](
    inOutDescr: InOutDescr[In, Out],
    defaultServiceOutMock: MockedServiceResponse[ServiceOut],
    serviceInExample: ServiceIn,
    otherEnumInExamples: Option[Seq[In]] = None,
    otherEnumOutExamples: Option[Seq[Out]] = None,
    dynamicServiceOutMock: Option[In => MockedServiceResponse[ServiceOut]] = None,
    @deprecated(
      "Default is _GenericExternalTaskProcessName_ - in future only used as External Task"
    )
    override val processName: String = GenericExternalTaskProcessName,
    protected val outputMock: Option[Out] = None,
    protected val servicesMocked: Boolean = false,
    protected val outputServiceMock: Option[MockedServiceResponse[ServiceOut]] = None,
    protected val outputVariables: Seq[String] = Seq.empty,
    protected val manualOutMapping: Boolean = false,
    protected val handledErrors: Seq[ErrorCodeType] = Seq.empty,
    protected val regexHandledErrors: Seq[String] = Seq.empty,
    protected val impersonateUserId: Option[String] = None
) extends ExternalTask[In, Out, ServiceTask[In, Out, ServiceIn, ServiceOut]]:
  lazy val dynamicOutMock: Option[In => Out] = None
  @deprecated("Use _topicName_")
  lazy val serviceName: String               = inOutDescr.id

  def withInOutDescr(
      descr: InOutDescr[In, Out]
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(inOutDescr = descr)

  def withProcessName(
      processName: String
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(processName = processName)

  def mockWith(outputMock: Out): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(outputMock = Some(outputMock))

  def mockWith(outputMock: In => MockedServiceResponse[ServiceOut])
      : ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(dynamicServiceOutMock = Some(outputMock))

  def mockServicesWithDefault: ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(servicesMocked = true)

  def mockServiceWith(
      outputServiceMock: MockedServiceResponse[ServiceOut]
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(outputServiceMock = Some(outputServiceMock))

  // shortcut for success case
  def mockServiceWith(
      outputServiceMock: ServiceOut
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(outputServiceMock = Some(MockedServiceResponse.success200(outputServiceMock)))

  def withOutputVariables(names: String*): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(outputVariables = names)

  def withOutputVariable(
      processName: String
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(outputVariables = outputVariables :+ processName)

  def withManualOutMapping: ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(manualOutMapping = true)

  def handleErrors(
      errorCodes: ErrorCodeType*
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(handledErrors = errorCodes)

  def handleError(
      errorCode: ErrorCodeType
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(handledErrors = handledErrors :+ errorCode)

  def handleErrorWithRegex(
      regex: String
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(regexHandledErrors = regexHandledErrors :+ regex)

  def withImpersonateUserId(
      impersonateUserId: String
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(impersonateUserId = Some(impersonateUserId))

  def withEnumInExample(
      enumInExample: In
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) :+ enumInExample)
    )
  def withEnumOutExample(
      enumOutExample: Out
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) :+ enumOutExample)
    )

  def withEnumInExamples(
      enumInExamples: In*
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) ++ enumInExamples)
    )

  def withEnumOutExamples(
      enumOutExamples: Out*
  ): ServiceTask[In, Out, ServiceIn, ServiceOut] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) ++ enumOutExamples)
    )

  override def camundaInMap: Map[String, CamundaVariable] =
    val camundaOutputServiceMock = outputServiceMock
      .map(m =>
        InputParams.outputServiceMock.toString -> CamundaVariable.valueToCamunda(
          m.asJson.deepDropNullValues
        )
      )
      .toMap
    super.camundaInMap ++ camundaOutputServiceMock
  end camundaInMap

end ServiceTask

case class CustomTask[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema}
](
    inOutDescr: InOutDescr[In, Out],
    otherEnumInExamples: Option[Seq[In]] = None,
    otherEnumOutExamples: Option[Seq[Out]] = None,
    dynamicOutMock: Option[In => Out] = None,
    protected val outputMock: Option[Out] = None,
    protected val outputVariables: Seq[String] = Seq.empty,
    protected val servicesMocked: Boolean = false,
    protected val manualOutMapping: Boolean = false,
    protected val impersonateUserId: Option[String] = None,
    protected val handledErrors: Seq[ErrorCodeType] = Seq.empty,
    protected val regexHandledErrors: Seq[String] = Seq.empty
) extends ExternalTask[In, Out, CustomTask[In, Out]]:

  def withInOutDescr(descr: InOutDescr[In, Out]): CustomTask[In, Out] =
    copy(inOutDescr = descr)

  def withImpersonateUserId(impersonateUserId: String): CustomTask[In, Out] =
    copy(impersonateUserId = Some(impersonateUserId))

  def mockServices: CustomTask[In, Out] =
    copy(servicesMocked = true)

  def mockWith(outputMock: Out): CustomTask[In, Out] =
    copy(outputMock = Some(outputMock))

  def mockWith(outputMock: In => Out): CustomTask[In, Out] =
    copy(dynamicOutMock = Some(outputMock))

  def withOutputVariables(names: String*): CustomTask[In, Out] =
    copy(outputVariables = names)

  def withOutputVariable(name: String): CustomTask[In, Out] =
    withOutputVariables(name)

  def handleErrors(
      errorCodes: ErrorCodeType*
  ): CustomTask[In, Out] =
    copy(handledErrors = errorCodes)

  def handleError(
      errorCode: ErrorCodeType
  ): CustomTask[In, Out] =
    copy(handledErrors = handledErrors :+ errorCode)

  def handleErrorWithRegex(
      regex: String
  ): CustomTask[In, Out] =
    copy(regexHandledErrors = regexHandledErrors :+ regex)

  def withEnumInExample(
      enumInExample: In
  ): CustomTask[In, Out] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) :+ enumInExample)
    )
  def withEnumOutExample(
      enumOutExample: Out
  ): CustomTask[In, Out] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) :+ enumOutExample)
    )

  def withEnumInExamples(
      enumInExamples: In*
  ): CustomTask[In, Out] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) ++ enumInExamples)
    )

  def withEnumOutExamples(
      enumOutExamples: Out*
  ): CustomTask[In, Out] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) ++ enumOutExamples)
    )

end CustomTask

case class UserTask[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    Out <: Product: {InOutEncoder, InOutDecoder, Schema}
](
    inOutDescr: InOutDescr[In, Out],
    otherEnumInExamples: Option[Seq[In]] = None,
    otherEnumOutExamples: Option[Seq[Out]] = None
) extends ProcessNode,
      Activity[In, Out, UserTask[In, Out]]:
  lazy val inOutType: InOutType = InOutType.UserTask

  override lazy val camundaToCheckMap: Map[String, CamundaVariable] =
    camundaInMap

  def withInOutDescr(descr: InOutDescr[In, Out]): UserTask[In, Out] =
    copy(inOutDescr = descr)

  def withEnumInExample(
      enumInExample: In
  ): UserTask[In, Out] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) :+ enumInExample)
    )
  def withEnumOutExample(
      enumOutExample: Out
  ): UserTask[In, Out] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) :+ enumOutExample)
    )

  def withEnumInExamples(
      enumInExamples: In*
  ): UserTask[In, Out] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) ++ enumInExamples)
    )

  def withEnumOutExamples(
      enumOutExamples: Out*
  ): UserTask[In, Out] =
    copy(otherEnumOutExamples =
      Some(otherEnumOutExamples.getOrElse(Seq.empty) ++ enumOutExamples)
    )

end UserTask

object UserTask:

  def init(id: String): UserTask[NoInput, NoOutput] =
    UserTask(
      InOutDescr(id, NoInput(), NoOutput())
    )
end UserTask

sealed trait ReceiveEvent[
    In <: Product: {InOutEncoder, InOutDecoder, Schema},
    T <: ReceiveEvent[In, T]
] extends ProcessNode,
      Activity[In, NoOutput, T]:
  lazy val otherEnumOutExamples: Option[Seq[NoOutput]] = None
end ReceiveEvent

case class MessageEvent[
    In <: Product: {InOutEncoder, InOutDecoder, Schema}
](
    messageName: String,
    inOutDescr: InOutDescr[In, NoOutput],
    otherEnumInExamples: Option[Seq[In]] = None
) extends ReceiveEvent[In, MessageEvent[In]]:
  lazy val inOutType: InOutType = InOutType.Message

  def withInOutDescr(descr: InOutDescr[In, NoOutput]): MessageEvent[In] =
    copy(inOutDescr = descr)

  def withEnumInExample(
      enumInExample: In
  ): MessageEvent[In] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) :+ enumInExample)
    )
end MessageEvent

object MessageEvent:

  def init(id: String): MessageEvent[NoInput] =
    MessageEvent(
      id,
      InOutDescr(id, NoInput(), NoOutput())
    )
end MessageEvent

case class SignalEvent[
    In <: Product: {InOutEncoder, InOutDecoder, Schema}
](
    messageName: String,
    inOutDescr: InOutDescr[In, NoOutput],
    otherEnumInExamples: Option[Seq[In]] = None
) extends ReceiveEvent[In, SignalEvent[In]]:
  lazy val inOutType: InOutType = InOutType.Signal

  def withInOutDescr(descr: InOutDescr[In, NoOutput]): SignalEvent[In] =
    copy(inOutDescr = descr)

  def withEnumInExample(
      enumInExample: In
  ): SignalEvent[In] =
    copy(otherEnumInExamples =
      Some(otherEnumInExamples.getOrElse(Seq.empty) :+ enumInExample)
    )

end SignalEvent

object SignalEvent:

  val Dynamic_ProcessInstance                = "{processInstanceId}"
  def init(id: String): SignalEvent[NoInput] =
    SignalEvent(
      id,
      InOutDescr(id, NoInput(), NoOutput())
    )
end SignalEvent

case class TimerEvent(
    title: String,
    inOutDescr: InOutDescr[NoInput, NoOutput]
) extends ReceiveEvent[NoInput, TimerEvent]:
  lazy val inOutType: InOutType                      = InOutType.Timer
  lazy val otherEnumInExamples: Option[Seq[NoInput]] = None

  def withInOutDescr(descr: InOutDescr[NoInput, NoOutput]): TimerEvent =
    copy(inOutDescr = descr)
end TimerEvent

object TimerEvent:

  def init(title: String): TimerEvent =
    TimerEvent(title, InOutDescr(title, NoInput(), NoOutput()))
end TimerEvent

def valueToJson(value: Any): Json =
  value match
    case v: Int             =>
      Json.fromInt(v)
    case v: Long            =>
      Json.fromLong(v)
    case v: Boolean         =>
      Json.fromBoolean(v)
    case v: Float           =>
      Json.fromFloat(v).getOrElse(Json.Null)
    case v: Double          =>
      Json.fromDouble(v).getOrElse(Json.Null)
    case null               =>
      Json.Null
    case ld: LocalDate      =>
      Json.fromString(ld.toString)
    case ldt: LocalDateTime =>
      Json.fromString(ldt.toString)
    case zdt: ZonedDateTime =>
      Json.fromString(zdt.toString)
    case v                  =>
      Json.fromString(v.toString)
end valueToJson
