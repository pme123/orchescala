package orchescala.dmntester

import orchescala.dmntester.server.{DmnTesterServer, DmnTesterServerConfig}
import sttp.client3.*

import scala.util.{Failure, Success, Try}

/** Starts the DMN Tester - in the very same JVM as the project that uses it.
  *
  * There is no Docker and no image any more: `orchescala-dmntester-server`
  * brings the engine, the http server and the UI along.
  */
trait DmnTesterStarter extends DmnTesterHelpers:

  lazy val startDmnTester: Unit =
    if DmnTesterServer.isRunning then
      println(s"DMN Tester is already running: $testerUrl")
    else
      foreignTester match
        case Some(app) =>
          println(
            s"""|Port ${testerConfig.exposedPort} is already used by another DMN Tester: $app
                |This project is: ${getClass.getName}
                |> Stop that one, or give this project its own port:
                |>   DmnTesterStarterConfig(..., exposedPort = ${testerConfig.exposedPort + 1})""".stripMargin
          )
        case None =>
          DmnTesterServer.start(
            DmnTesterServerConfig(
              configPaths = testerConfig.configPathsForServer,
              port = testerConfig.exposedPort,
              startingApp = getClass.getName
            )
          )
          println(s"Open the browser: $testerUrl")
  end startDmnTester

  protected lazy val testerUrl: String =
    s"http://localhost:${testerConfig.exposedPort}"

  /** is there already a tester of ANOTHER project on our port? */
  private def foreignTester: Option[String] =
    Try(
      client
        .send(basicRequest.get(uri"$infoUrl").response(asString))
        .body
    ) match
      case Success(Right(app)) => Some(app)
      case Success(Left(_))    => None
      case Failure(_)          => None

end DmnTesterStarter
