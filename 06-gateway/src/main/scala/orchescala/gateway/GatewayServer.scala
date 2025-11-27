package orchescala.gateway

import orchescala.engine.*
import orchescala.engine.c7.{C7Client, C7ProcessEngine, SharedC7ClientManager}
import orchescala.engine.c8.{C8Client, C8ProcessEngine, SharedC8ClientManager}
import orchescala.engine.domain.EngineError
import orchescala.engine.gateway.GProcessEngine
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

  def port: Int = 8888

  var theWorkers: Set[WorkerDsl[?, ?]] = Set.empty

  /** Add all the workers you want to support.
    *
    * You can add single workers, lists of workers or even complete WorkerApps. And a mix of all of
    * the above.
    */
  def supportedWorkers(dWorkers: (WorkerDsl[?, ?] | Seq[WorkerDsl[?, ?]] | WorkerApp)*): Unit =
    theWorkers = dWorkers
      .flatMap:
        case d: WorkerDsl[?, ?] => Seq(d)
        case s: Seq[?]          => s.collect { case d: WorkerDsl[?, ?] => d }
        case app: WorkerApp     => app.theWorkers
      .toSet

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
        _ <- ZIO.logInfo(s"Starting Engine Gateway Server on port $port")
        _ <- ZIO.logInfo(s"\n${theWorkers.size} supported Workers: \n- ${theWorkers.map(_.topic).mkString("\n- ")}")

        // Create gateway engine
        gatewayEngine <- engineZIO

        // Create routes
        apiRoutes    = GatewayRoutes.routes(
                         gatewayEngine.processInstanceService,
                         gatewayEngine.userTaskService,
                         gatewayEngine.signalService,
                         gatewayEngine.messageService,
                         gatewayEngine.historicVariableService,
                         validateToken
                       )
        workerRoutes = WorkerRoutes.routes(theWorkers, validateToken)
        docsRoutes   = OpenApiRoutes.routes
        allRoutes    = apiRoutes ++ workerRoutes ++ docsRoutes

        // Start server
        _ <- ZIO.logInfo(s"Server ready at http://localhost:$port")
        _ <- ZIO.logInfo(s"API Documentation available at http://localhost:$port/docs")
        _ <- Server.serve(allRoutes).forever
      yield ()

    program.provide(
      Server.defaultWithPort(port),
      EngineRuntime.logger
    ).unit
  end start

  protected lazy val validateToken: String => IO[EngineError, String] =
    GatewayRoutes.defaultTokenValidator
end GatewayServer
