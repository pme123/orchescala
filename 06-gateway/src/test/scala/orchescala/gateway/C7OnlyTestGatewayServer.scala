package orchescala.gateway

import orchescala.engine.*
import orchescala.engine.c7.{C7DefaultBearerTokenClient, C7ProcessEngine, SharedC7ClientManager}
import orchescala.engine.domain.EngineError
import orchescala.engine.gateway.GProcessEngine
import orchescala.worker.DefaultWorkerConfig
import zio.*

/** Test server that exposes the gateway with only a Camunda 7 engine.
  *
  * Use this to test manifest deployment against a local Camunda 7 instance.
  *
  * Run with:
  *   sbt "project gateway" "Test/runMain orchescala.gateway.C7OnlyTestGatewayServer"
  */
object C7OnlyTestGatewayServer extends GatewayServer:

  override def config: GatewayConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
    gatewayPort = sys.env.get("GATEWAY_PORT").flatMap(_.toIntOption).getOrElse(8888)
  )

  private val c7Client = C7DefaultBearerTokenClient:
    sys.env.getOrElse("CAMUNDA_C7_REST_URL", "http://localhost:8080/engine-rest")

  given EngineConfig = DefaultEngineConfig()

  override def engineZIO: ZIO[Any, EngineError, ProcessEngine] =
    C7ProcessEngine
      .withClient(c7Client)
      .map: c7Engine =>
        given Seq[ProcessEngine] = Seq(c7Engine)
        GProcessEngine()
      .provideLayer(SharedC7ClientManager.layer)

end C7OnlyTestGatewayServer
