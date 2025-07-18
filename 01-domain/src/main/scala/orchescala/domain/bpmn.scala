package orchescala.domain

import orchescala.domain.*

import scala.compiletime.{constValue, constValueTuple}
import scala.reflect.Enum

// sttp
export sttp.model.StatusCode

def toJsonString[T <: Product: InOutEncoder](product: T): String =
  product.asJson.deepDropNullValues.toString

@deprecated("Use `Optable`.")
def maybe[T](value: T | Option[T]): Option[T] = value match
  case v: Option[?] => v.asInstanceOf[Option[T]]
  case v            => Some(v.asInstanceOf[T])

inline def allFieldNames[T <: Enum | Product]: Seq[String] = ${ FieldNamesOf.allFieldNames[T] }
inline def nameOfVariable(inline x: Any): String           = ${ NameOf.nameOfVariable('x) }
inline def nameOfType[A]: String                           = ${ NameOf.nameOfType[A] }

enum InputParams:
  // mocking
  case servicesMocked
  case mockedWorkers
  case outputMock
  case outputServiceMock
  // mapping
  case manualOutMapping
  case outputVariables
  case handledErrors
  case regexHandledErrors
  // authorization
  case impersonateUserId
  // special cases
  case topicName
  case inConfig
end InputParams

type ErrorCodeType = ErrorCodes | String | Int

enum ErrorCodes:
  // engine errors
  case `engine-mapping-error`
  case `engine-decoding-error`
  case `engine-encoding-error`
  case `engine-process-error`
  case `engine-dmn-error`
  case `engine-worker-error`
  case `engine-service-error`
  
  // worker errors
  case `output-mocked` // mocking successful - but the mock is sent as BpmnError to handle in the diagram correctly
  case `mocking-failed`
  case `validation-failed`
  case `error-unexpected`
  case `error-handledRegexNotMatched`
  case `running-failed`
  case `bad-variable`
  case `mapping-error`
  case `custom-run-error`
  case `service-mapping-error`
  case `service-mocking-error`
  case `service-bad-path-error`
  case `service-auth-error`
  case `service-bad-body-error`
  case `service-unexpected-error`
  case `error-already-handled`
end ErrorCodes

val GenericExternalTaskProcessName = "orchescala-externalTask-generic"

object GenericExternalTask:
  enum ProcessStatus:
    case succeeded, `404`, `400`, `output-mocked`, `validation-failed`
  object ProcessStatus:
    given ApiSchema[ProcessStatus]  = deriveEnumApiSchema
    given InOutCodec[ProcessStatus] = deriveEnumInOutCodec
end GenericExternalTask

trait WithConfig[InConfig <: Product: InOutCodec]:
  def inConfig: Option[InConfig]
  def defaultConfig: InConfig
  lazy val defaultConfigAsJson: Json = defaultConfig.asJson

case class NoInConfig()

object NoInConfig:
  given InOutCodec[NoInConfig] = deriveCodec
  given ApiSchema[NoInConfig]  = deriveApiSchema

// ApiCreator that describes these variables
case class GeneralVariables(
    // mocking
    servicesMocked: Boolean = false,             // Process only
    mockedWorkers: Seq[String] = Seq.empty,      // Process only
    outputMock: Option[Json] = None,
    outputServiceMock: Option[Json] = None,      // Service only
    // mapping
    manualOutMapping: Boolean = false,           // Service only
    outputVariables: Seq[String] = Seq.empty,    // Service only
    handledErrors: Seq[String] = Seq.empty,      // Service only
    regexHandledErrors: Seq[String] = Seq.empty, // Service only
    // authorization
    impersonateUserId: Option[String] = None
):
  def isMockedWorker(workerTopicName: String): Boolean =
    mockedWorkers.contains(workerTopicName)
end GeneralVariables

object GeneralVariables:
  given InOutCodec[GeneralVariables] = CirceCodec.from(decoder, deriveInOutEncoder)
  given ApiSchema[GeneralVariables]  = deriveApiSchema

  lazy val decoder: Decoder[GeneralVariables] = new Decoder[GeneralVariables] :
    final def apply(c: HCursor): Decoder.Result[GeneralVariables] =
      for
        servicesMocked <- c.downField("servicesMocked").as[Option[Boolean]].map(_.getOrElse(false))
        mockedWorkers <- c.downField("mockedWorkers").as[Option[Seq[String]]].map(_.getOrElse(Seq.empty))
        outputMock <- c.downField("outputMock").as[Option[Json]]
        outputServiceMock <- c.downField("outputServiceMock").as[Option[Json]]
        manualOutMapping <- c.downField("manualOutMapping").as[Option[Boolean]].map(_.getOrElse(false))
        outputVariables <- c.downField("outputVariables").as[Option[Seq[String]]].map(_.getOrElse(Seq.empty))
        handledErrors <- c.downField("handledErrors").as[Option[Seq[String]]].map(_.getOrElse(Seq.empty))
        regexHandledErrors <- c.downField("regexHandledErrors").as[Option[Seq[String]]].map(_.getOrElse(Seq.empty))
        impersonateUserId <- c.downField("impersonateUserId").as[Option[String]]
      yield GeneralVariables(
        servicesMocked,
        mockedWorkers,
        outputMock,
        outputServiceMock,
        manualOutMapping,
        outputVariables,
        handledErrors,
        regexHandledErrors,
        impersonateUserId
      )
end GeneralVariables

def typeDescription(obj: AnyRef) =
  s"The type of an Enum -> '**${enumType(obj)}**'. Just use the the enum type. This is needed for simple unmarshalling the JSON"
def enumType(obj: AnyRef)        =
  s"$obj"

case class ProcessLabels(labels: Option[Seq[ProcessLabel]]):
  lazy val toMap: Map[String, String] =
    labels.toSeq.flatten
      .map:
        case ProcessLabel(k, v) => k -> v
      .toMap

  lazy val print: String =
    labels.toSeq.flatten
      .map:
        case ProcessLabel(k, v) => s" - $k: $v\n"
      .mkString
  lazy val de: String    =
    labels.toSeq.flatten
      .collectFirst:
        case ProcessLabel(k, v) if k == ProcessLabels.labelKeyDe =>
          v
      .getOrElse("-")
  lazy val fr: String    =
    labels.toSeq.flatten
      .collectFirst:
        case ProcessLabel(k, v) if k == ProcessLabels.labelKeyFr =>
          v
      .getOrElse("-")

end ProcessLabels

object ProcessLabels:
  val labelKeyDe = "callingProcessKeyDE"
  val labelKeyFr = "callingProcessKeyFR"

  lazy val none: ProcessLabels = ProcessLabels(None)

  def apply(label: ProcessLabel, labels: ProcessLabel*): ProcessLabels =
    ProcessLabels(Some(label +: labels))

  def apply(valueDe: String, valueFr: String): ProcessLabels =
    ProcessLabels(ProcessLabel(labelKeyDe, valueDe), ProcessLabel(labelKeyFr, valueFr))

end ProcessLabels

case class ProcessLabel(key: String, value: String)

object ProcessLabel:
  def none(label: String): ProcessLabel = ProcessLabel(label, "-")
end ProcessLabel

type ValueSimple = String | Boolean | Int | Long | Double
given ApiSchema[ValueSimple] = Schema.derivedUnion

given InOutCodec[ValueSimple] = CirceCodec.from(valueDecoder, valueEncoder)

lazy val valueEncoder = new InOutEncoder[ValueSimple]:
  def apply(a: ValueSimple): Json = valueToJson(a)

lazy val valueDecoder = new InOutDecoder[ValueSimple]:
  def apply(c: HCursor): Decoder.Result[ValueSimple] =
    c.as[Int].orElse(c.as[Long]).orElse(c.as[Double]).orElse(c.as[String]).orElse(c.as[Boolean])

lazy val NewName   = """^.+\-(.+V.+\-(.+))$""".r // mycompany-myproject-myprocessV1-MyWorker
lazy val OldName1  =
  """^.+\-(.+\.(post|get|patch|put|delete))$""".r // mycompany-myproject-myprocessV1.MyWorker.get or mycompany-myproject-MyWorker.get - use NewName for the new naming convention
lazy val OldName2  =
  """^.+\-(.+V.+\.(.+))$""".r                     // mycompany-myproject-myprocessV1.MyWorker - use NewName for the new naming convention
lazy val OldName31 =
  """^.+\-.+(\-(.+\-..+\-.+))$""".r               // mycompany-myproject-myprocess-other-MyWorker - use NewName for the new naming convention
lazy val OldName32 =
  """^.+\-.+(\-(.+\-.+))$""".r                    // mycompany-myproject-myprocess-MyWorker - use NewName for the new naming convention
lazy val OldName4  =
  """^.+\-.+\-(.+)$""".r                          // mycompany-myproject-myprocess.MyWorker - use NewName for the new naming convention

def shortenName(name: String): String =
  name match
    case OldName1(n, _)  if n.count(_ == '.') == 1 =>
      n
    case OldName1(n, _)  =>
      println("OldName1+: " + n)
      n.split("\\.").drop(1).mkString(".")
    case NewName(_, n)   =>
      println("NewName: " + n)
      n
    case OldName2(_, n)  =>
      n
    case OldName31(_, n) =>
      n
    case OldName32(_, n) =>
      n
    case OldName4(n)     =>
      n
    case _               => // something else
      name

lazy val diagramPath: os.RelPath = os.rel / "src" / "main" / "resources" / "camunda"
