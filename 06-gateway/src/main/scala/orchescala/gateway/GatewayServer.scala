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
          _ <- EngineRuntime.threadPoolFinalizer
          _ <- HttpClientProvider.threadPoolFinalizer
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
        Server.defaultWithPort(config.gatewayPort)
    ).unit
  end start

  private def routes(gatewayEngine: ProcessEngine)(using GatewayConfig): Routes[Any, Response] =

    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(
      WorkerRoutes().routes ++
        ProcessInstanceRoutes(
          gatewayEngine.processInstanceService,
          gatewayEngine.historicVariableService
        ).routes ++
        UserTaskRoutes(
          gatewayEngine.userTaskService
        ).routes ++
        SignalRoutes(
          gatewayEngine.signalService
        ).routes ++
        MessageRoutes(
          gatewayEngine.messageService
        ).routes
    ) ++
      OpenApiRoutes.routes

  // Log environment info on startup
  println(EnvironmentDetector.environmentInfo)

  // Example: Adjust configuration based on environment
  protected val isLocalDev = EnvironmentDetector.isLocalhost

  if isLocalDev then
    println("🏠 Running on localhost (not in Docker)")
  else if EnvironmentDetector.isRunningInDocker then
    println("🐳 Running in Docker container")
    
end GatewayServer
