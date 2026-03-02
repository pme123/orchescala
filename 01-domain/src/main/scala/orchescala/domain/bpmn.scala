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
  case _servicesMocked
  case _mockedWorkers
  case _outputMock
  case _outputServiceMock
  // mapping
  case _manualOutMapping
  case _outputVariables
  case _handledErrors
  case _regexHandledErrors
  // authorization
  case _identityCorrelation
  @deprecated("Use `identityCorrelation`") 
  case impersonateUserId
  @deprecated("Use `_servicesMocked`")
  case servicesMocked
  @deprecated("Use `_mockedWorkers`")
  case mockedWorkers
  @deprecated("Use `_outputMock`")
  case outputMock
  @deprecated("Use `_outputServiceMock`")
  case outputServiceMock
  @deprecated("Use `_manualOutMapping`")
  case manualOutMapping
  @deprecated("Use `_outputVariables`")
  case outputVariables
  @deprecated("Use `_handledErrors`")
  case handledErrors
  @deprecated("Use `_regexHandledErrors`")
  case regexHandledErrors

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
  """^.+\-(.+V.+\.(.+))$""".r // mycompany-myproject-myprocessV1.MyWorker - use NewName for the new naming convention
lazy val OldName31 =
  """^.+\-.+(\-(.+\-..+\-.+))$""".r // mycompany-myproject-myprocess-other-MyWorker - use NewName for the new naming convention
lazy val OldName32 =
  """^.+\-.+(\-(.+\-.+))$""".r // mycompany-myproject-myprocess-MyWorker - use NewName for the new naming convention
lazy val OldName4  =
  """^.+\-.+\-(.+)$""".r // mycompany-myproject-myprocess.MyWorker - use NewName for the new naming convention

def shortenName(name: String): String =
  name match
    case OldName1(n, _) if n.count(_ == '.') == 1 =>
      n
    case OldName1(n, _)                           =>
      println("OldName1+: " + n)
      n.split("\\.").drop(1).mkString(".")
    case NewName(_, n)                            =>
      println("NewName: " + n)
      n
    case OldName2(_, n)                           =>
      println("OldName2: " + n)
      n
    case OldName31(_, n)                          =>
      println("OldName31: " + n)
      n
    case OldName32(_, n)                          =>
      println("OldName32: " + n)
      n
    case OldName4(n)                              =>
      println("OldName4: " + n)
      n
    case _                                        => // something else
      println("OtherName: " + name)
      name

enum BpmnProcessType:
  def diagramPath: os.RelPath
  case C7(diagramPath: os.RelPath = os.rel / "src" / "main" / "resources" / "camunda")
  case C8(diagramPath: os.RelPath = os.rel / "src" / "main" / "resources" / "camunda8")
  case Op(diagramPath: os.RelPath = os.rel / "src" / "main" / "resources" / "camunda")

object BpmnProcessType:
  def diagramPaths: Seq[os.RelPath] =
    Seq(C7().diagramPath) // TODO not supported yet: , C8().diagramPath)
end BpmnProcessType
