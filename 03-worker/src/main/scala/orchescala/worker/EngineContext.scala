package orchescala
package worker

import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig, Slf4JLogger}

import java.time.{LocalDate, LocalDateTime}
import scala.reflect.ClassTag

trait EngineContext:
  def engineConfig: EngineConfig
  def workerConfig: WorkerConfig
  def getLogger(clazz: Class[?]): OrchescalaLogger
  def toEngineObject: Json => Any

  def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
      request: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut]

  def jsonObjectToEngineObject(
      json: JsonObject
  ): Map[String, Any] =
    json.toMap
      .map { case (k, v) => k -> jsonToEngineValue(v) }

  def toEngineObject[T <: Product: InOutEncoder](
      product: T
  ): Map[String, Any] =
    product.productElementNames
      .zip(product.productIterator)
      // .filterNot { case _ -> v => v.isInstanceOf[None.type] } // don't send null
      .map { case (k, v) => k -> objectToEngineObject(product, k, v) }
      .toMap

  def toEngineObject(
      variables: Map[String, Json]
  ): Map[String, Any] =
    variables
      .map { case (k, v) => k -> jsonToEngineValue(v) }

  def valuesToEngineObject(
      variables: Map[String, Any]
  ): Map[String, Any] =
    variables
      .map { case (k, v) => k -> valueToEngineObject(v) }

  def objectToEngineObject[T <: Product: InOutEncoder](
      product: T,
      key: String,
      value: Any
  ): Any =
    value match
      case None | null => null
      case Some(v) => objectToEngineObject(product, key, v)
      case v: (Product | Iterable[?] | Map[?, ?]) =>
        product.asJson.hcursor
          .downField(key)
          .as[Json] match
          case Right(v) => jsonToEngineValue(v)
          case Left(ex) =>
            throwErr(s"$key of $v could NOT be Parsed to a JSON!\n$ex")

      case v =>
        valueToEngineObject(v)

  def valueToEngineObject(value: Any): Any =
    value match
      case v: scala.reflect.Enum =>
        v.toString
      case ld: LocalDate =>
        ld.toString
      case ldt: LocalDateTime =>
        ldt.toString
      case other if other == null =>
        null
      case v: Json =>
        jsonToEngineValue(v)
      case other =>
        other

  def domainObjToEngineObject[A <: Product: InOutCodec](variable: A): Any =
    toEngineObject(variable.asJson.deepDropNullValues)

  def jsonToEngineValue(json: Json): Any =
    json match
      case j if j.isNull => null
      case j if j.isNumber =>
        j.asNumber.get.toBigDecimal.get match
          case n if n.isValidInt => n.toInt
          case n if n.isValidLong => n.toLong
          case n => n.toDouble
      case j if j.isBoolean => j.asBoolean.get
      case j if j.isString => j.asString.get
      case j =>
        toEngineObject(j.deepDropNullValues)
  end jsonToEngineValue

end EngineContext

// mainly used for testing
case class DefaultEngineContext(
    engineConfig: EngineConfig,
    workerConfig: WorkerConfig,
    getLoggerFn: Class[?] => OrchescalaLogger,
    toEngineObject: Json => Any,
    restApiClient: RestApiClient
                               ) extends EngineContext:

  def getLogger(clazz: Class[?]): OrchescalaLogger = getLoggerFn(clazz)

  def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
      request: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut] =
    restApiClient.sendRequest(request)

object DefaultEngineContext:
  lazy val example = DefaultEngineContext(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false),
    getLoggerFn = c => Slf4JLogger.logger(c.getName),
    toEngineObject = json => json,
    restApiClient = DefaultRestApiClient
  )


/** The process instance a job runs in - an IdentityCorrelation must be bound to it, or to its
  * root: a call activity inherits the correlation of its parent, signed for the root instance.
  *
  * @param rootId
  *   looks the root process instance up - only evaluated if the correlation is not bound to `id`
  *   itself (C8 delivers it with the job, C7 / Operaton look it up in the history, cached)
  */
final case class JobProcessInstance(id: String, rootId: IO[String, Option[String]])

/** @param processInstance
  *   the process instance of the job - None for the `/worker` endpoint (no job, no process yet)
  * @param workerTimeout
  *   how long the worker may run (`WorkerDsl.timeout`) - its service calls may take as long
  */
final case class EngineRunContext(
    engineContext: EngineContext,
    generalVariables: GeneralVariables,
    processInstance: Option[JobProcessInstance] = None,
    workerTimeout: Option[scala.concurrent.duration.FiniteDuration] = None
):

  def getLogger(clazz: Class[?]): OrchescalaLogger = engineContext.getLogger(clazz)

  def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
      request: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut] =
    engineContext.sendRequest(request)

  def toEngineObject[T <: Product: InOutEncoder](
      product: T
  ): Map[String, Any] =
    engineContext.toEngineObject(product)

  def toEngineObject(
      variables: Map[String, Json]
  ): Map[String, Any] =
    engineContext.toEngineObject(variables)

  def jsonObjectToEngineObject(
      json: JsonObject
  ): Map[String, Any] =
    engineContext.jsonObjectToEngineObject(json)

end EngineRunContext
