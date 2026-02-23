package orchescala.gateway

import orchescala.engine.*
import orchescala.engine.rest.HttpClientProvider
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
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
  
  override val bootstrap: ZLayer[ZIOAppArgs, Any, Any] = EngineRuntime.logger
  
  def config: GatewayConfig

  def run: ZIO[Any, Any, Any] = start()

  /** Starts the Gateway HTTP server with the specified configuration.
    *
    * @return
    *   A ZIO effect that runs the server
    */
  def start(): ZIO[Any, Throwable, Unit] =

    val program =
      ZIO.scoped:
        for
          _           <- EngineRuntime.threadPoolFinalizer
          _           <- HttpClientProvider.threadPoolFinalizer
          _ <- ZIO.logInfo(banner("Engine Gateway Server"))
          _ <- ZIO.logInfo(s"Starting Engine Gateway Server on port ${config.gatewayPort}")

          // Create gateway engine (with shared client layers provided)
          gatewayEngine      <- engineZIO
          given GatewayConfig = config
          // Create routes
          allRoutes           = routes(gatewayEngine)

          // Start server
          _ <- ZIO.logInfo(s"Server ready at http://localhost:${config.gatewayPort}")
          _ <- ZIO.logInfo(
                 s"API Documentation available at http://localhost:${config.gatewayPort}/docs"
               )
          _ <- Server.serve(allRoutes).forever
        yield ()

    program.provide(
      EngineRuntime.sharedExecutorLayer ++
        HttpClientProvider.live ++
        requiredEngineLayers ++
        Server.defaultWithPort(config.gatewayPort)
    ).unit
  end start

  /** Override this method to provide shared client layers (e.g., SharedC7ClientManager, SharedC8ClientManager)
    * These layers will be scoped to the entire server lifetime, ensuring finalizers are called on shutdown.
    */
  protected def requiredEngineLayers: ZLayer[Any, Nothing, Any]

  private def routes(gatewayEngine: ProcessEngine)(using GatewayConfig): Routes[Any, Response] =

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      WorkerRoutes().routes ++
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
