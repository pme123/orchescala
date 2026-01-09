package orchescala.gateway

import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import sttp.tapir.ztapir.*
import orchescala.engine.*
import orchescala.engine.services.*
import orchescala.worker.{WorkerApp, WorkerDsl}
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
abstract class GatewayServer extends EngineApp, ZIOAppDefault:

  def config: GatewayConfig = GatewayConfig.default

  def run: ZIO[Any, Any, Any] = start()

  /** Starts the Gateway HTTP server with the specified configuration.
    *
    * @return
    *   A ZIO effect that runs the server
    */
  def start(): ZIO[Any, Throwable, Unit] =

    val program =
      for
        _ <- ZIO.logInfo(banner("Engine Gateway Server"))
        _ <- ZIO.logInfo(s"Starting Engine Gateway Server on port ${config.port}")

        // Create gateway engine
        gatewayEngine      <- engineZIO
        given GatewayConfig = config
        // Create routes
        allRoutes           = routes(gatewayEngine)

        // Start server
        _ <- ZIO.logInfo(s"Server ready at http://localhost:${config.port}")
        _ <- ZIO.logInfo(s"API Documentation available at http://localhost:${config.port}/docs")
        _ <- Server.serve(allRoutes).forever
      yield ()

    program.provide(
      Server.defaultWithPort(config.port),
      EngineRuntime.logger
    ).unit
  end start

  private def routes(gatewayEngine: ProcessEngine)(using GatewayConfig): Routes[Any, Response] =

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      WorkerRoutes.routes ++
        ProcessInstanceRoutes.routes(
          gatewayEngine.processInstanceService,
          gatewayEngine.historicVariableService
        ) ++
        UserTaskRoutes.routes(
          gatewayEngine.userTaskService
        ) ++
        SignalRoutes.routes(
          gatewayEngine.signalService
        ) ++
        MessageRoutes.routes(
          gatewayEngine.messageService
        )
    ) ++
      OpenApiRoutes.routes

end GatewayServer
