package orchescala.worker.w4s

import orchescala.domain.*
import orchescala.engine.Slf4JLogger
import orchescala.worker.*

import scala.reflect.ClassTag

trait W4SContext extends EngineContext:

  def getLogger(clazz: Class[?]): OrchescalaLogger =
    Slf4JLogger.logger(clazz.getName)

  lazy val toEngineObject: Json => Any =
    json => json

  def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
      request: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut] =
    DefaultRestApiClient.sendRequest(request)
end W4SContext

