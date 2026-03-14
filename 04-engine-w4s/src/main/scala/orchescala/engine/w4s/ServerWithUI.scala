package orchescala.engine.w4s

import cats.effect.{IO, IOApp}
import com.typesafe.scalalogging.StrictLogging
import workflows4s.web.api.server.WorkflowEntry

object ServerWithUI extends IOApp.Simple with W4SServer with StrictLogging:

  val port = 4444

  def run: IO[Unit] =
    val apiUrl = sys.env.getOrElse("WORKFLOWS4S_API_URL", s"http://localhost:${port}")
    serverWithUi(port, apiUrl).use { server =>
      IO(logger.info(s"Server with UI running at http://${server.address}")) *>
        IO.never
    }
  end run

  protected def workflowEntries: List[WorkflowEntry[IO, ?]] = List.empty
end ServerWithUI
