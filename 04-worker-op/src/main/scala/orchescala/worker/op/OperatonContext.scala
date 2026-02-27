package orchescala.worker.op

import orchescala.domain.*
import orchescala.engine.Slf4JLogger
import orchescala.worker.*
import org.operaton.bpm.client.variable.ClientValues

import scala.reflect.ClassTag

trait OperatonContext extends EngineContext:

  def getLogger(clazz: Class[?]): OrchescalaLogger =
    Slf4JLogger.logger(clazz.getName)

  lazy val toEngineObject: Json => Any =
    json => ClientValues.jsonValue(json.toString)

  def sendRequest[ServiceIn: InOutEncoder, ServiceOut: {InOutDecoder, ClassTag}](
      request: RunnableRequest[ServiceIn]
  ): SendRequestType[ServiceOut] =
    DefaultRestApiClient.sendRequest(request)

end OperatonContext

