package orchescala.engine.gateway.http

import orchescala.engine.*
import orchescala.engine.c7.{C7BearerTokenClient, C7ProcessEngine, SharedC7ClientManager}
import orchescala.engine.gateway.GProcessEngine
import zio.*
import zio.http.*


/** Example Gateway Server with Bearer Token Authentication
  *
  * To run this example:
  * 1. Make sure Camunda 7 is running at http://localhost:8080
  * 2. Run from IntelliJ: Right-click and select "Run 'ExampleGatewayServer'"
  * 3. Or run from sbt: sbt "project engineGateway" "Test/runMain orchescala.engine.gateway.http.ExampleGatewayServer"
  * 4. Test with: curl -X POST http://localhost:8888/process/test-process/async \
  *                 -H "Authorization: Bearer YOUR_TOKEN" \
  *                 -H "Content-Type: application/json" \
  *                 -d '{"variables": {"test": true}}'
  */
object ExampleGatewayServer extends GatewayServer with ZIOAppDefault:

  /** Example C7 client with Bearer token pass-through authentication */
  object ExampleC7Client extends C7BearerTokenClient:
    override protected def camundaRestUrl: String =
      sys.env.getOrElse("CAMUNDA_REST_URL", "http://localhost:8080/engine-rest")

  /** Example Gateway configuration */
  given EngineConfig = EngineConfig(
    tenantId = None  // Set to Some("your-tenant") if needed
  )

  override def port: Int = 8888

  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
    (for
      c7Engine <- C7ProcessEngine.withClient(ExampleC7Client)
      given Seq[ProcessEngine] = Seq(c7Engine)
    yield GProcessEngine())
      .provideLayer(SharedC7ClientManager.layer)

  override def run: ZIO[Any, Any, Any] = start()

end ExampleGatewayServer

