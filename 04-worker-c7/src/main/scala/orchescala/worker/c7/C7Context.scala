package orchescala.worker.c7

import orchescala.domain.*
import orchescala.engine.Slf4JLogger
import orchescala.worker.*
import org.camunda.bpm.client.variable.ClientValues

import scala.reflect.ClassTag

trait C7Context extends EngineContext:

  def getLogger(clazz: Class[?]): OrchescalaLogger =
    Slf4JLogger.logger(clazz.getName)

  lazy val toEngineObject: Json => Any =
    json => ClientValues.jsonValue(json.toString)

  def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
      request: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut] =
    DefaultRestApiClient.sendRequest(request)

end C7Context
