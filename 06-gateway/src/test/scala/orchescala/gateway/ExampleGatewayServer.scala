package orchescala.gateway

import orchescala.engine.*
import orchescala.engine.c7.{
  C7BearerTokenClient,
  C7DefaultBearerTokenClient,
  C7ProcessEngine,
  SharedC7ClientManager
}
import orchescala.engine.c8.{
  C8BearerTokenClient,
  C8DefaultBearerTokenClient,
  C8ProcessEngine,
  SharedC8ClientManager
}
import orchescala.engine.domain.EngineError
import orchescala.engine.gateway.GProcessEngine
import orchescala.worker.DefaultWorkerConfig
import zio.*
import zio.http.*

/** Example Gateway Server with Bearer Token Authentication for both C7 and C8
  *
  * To run this example:
  *   1. Make sure Camunda 7 is running at http://localhost:8080 (optional)
  *   2. Make sure Camunda 8 is running at localhost:26500 (gRPC) and localhost:8080 (REST)
  *      (optional)
  *   3. Run from IntelliJ: Right-click and select "Run 'ExampleGatewayServer'"
  *   4. Or run from sbt: sbt "project engineGateway" "Test/runMain
  *      orchescala.engine.gateway.http.ExampleGatewayServer"
  *   5. Test with: curl -X POST http://localhost:8888/process/test-process/async \ -H
  *      "Authorization: Bearer YOUR_TOKEN" \ -H "Content-Type: application/json" \ -d '{"test":
  *      true}'
  *
  * Environment variables:
  *   - CAMUNDA_C7_REST_URL: Camunda 7 REST API URL (default: http://localhost:8080/engine-rest)
  *   - CAMUNDA_C8_GRPC_URL: Camunda 8 gRPC URL (default: http://localhost:26500)
  *   - CAMUNDA_C8_REST_URL: Camunda 8 REST API URL (default: http://localhost:8080)
  */
object ExampleGatewayServer extends GatewayServer:
  override def config: GatewayConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
  )

  /** Example C7 client with Bearer token pass-through authentication */
  val ExampleC7Client = C7DefaultBearerTokenClient:
    sys.env.getOrElse("CAMUNDA_C7_REST_URL", "http://localhost:8080/engine-rest")

  /** Example C8 client with Bearer token pass-through authentication */
  val ExampleC8Client = C8DefaultBearerTokenClient(
    sys.env.getOrElse("CAMUNDA_C8_GRPC_URL", "http://localhost:26500"),
    sys.env.getOrElse("CAMUNDA_C8_REST_URL", "http://localhost:8080")
  )

  /** Example Gateway configuration */
  given EngineConfig =
    DefaultEngineConfig(
    )

  override def engineZIO: ZIO[Any, EngineError, ProcessEngine] =
    (for
      c7Engine <- C7ProcessEngine.withClient(ExampleC7Client)
      c8Engine                <- C8ProcessEngine.withClient(ExampleC8Client)
      given Seq[ProcessEngine] = Seq(c7Engine, c8Engine)
    yield GProcessEngine())
      .provideLayer(SharedC7ClientManager.layer ++ SharedC8ClientManager.layer)

end ExampleGatewayServer
