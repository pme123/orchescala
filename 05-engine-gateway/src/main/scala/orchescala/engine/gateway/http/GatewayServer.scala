package orchescala.engine.gateway.http

import orchescala.engine.gateway.GProcessEngine
import orchescala.engine.{EngineApp, EngineConfig, EngineRuntime, ProcessEngine}
import orchescala.engine.c7.{C7Client, C7ProcessEngine, SharedC7ClientManager}
import orchescala.engine.c8.{C8Client, C8ProcessEngine, SharedC8ClientManager}
import zio.*
import zio.http.*

/** HTTP Server for the Engine Gateway.
  *
  * This server provides REST endpoints to interact with the Gateway, which automatically routes
  * requests to the appropriate Camunda engine (C7 or C8).
  *
  * Example usage:
  * {{{
  * object MyGatewayApp extends ZIOAppDefault:
  *   def run =
  *     GatewayServer.start(
  *       port = 8080,
  *       c7Clients = Seq(C7Client.local),
  *       c8Clients = Seq(C8Client.local)
  *     )
  * }}}
  */
abstract class GatewayServer extends EngineApp:

  def port: Int = 8080

  /** Starts the Gateway HTTP server with the specified configuration.
    *
    * @return
    *   A ZIO effect that runs the server
    */
  def start(): ZIO[Any, Throwable, Unit] =

    val program =
      for
        _             <- ZIO.logInfo(s"Starting Engine Gateway Server on port $port")
        // Create gateway engine
        gatewayEngine <- engineZIO

        // Create routes
        routes = GatewayRoutes.routes(gatewayEngine.processInstanceService)

        // Start server
        _ <- ZIO.logInfo(s"Server ready at http://localhost:$port")
        _ <- Server.serve(routes).forever
      yield ()

    program.provide(
      Server.defaultWithPort(port),
      EngineRuntime.logger
    ).unit
  end start

end GatewayServer
