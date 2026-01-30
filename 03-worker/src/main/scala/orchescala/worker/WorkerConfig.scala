package orchescala.worker

import orchescala.engine.EngineConfig
import sttp.tapir.Schema.annotations.description

trait WorkerConfig:
  def engineConfig: EngineConfig
  def workerAppPort: Int

  @description("Flag, if `true` identity correlation is required.")
  def identityVerification: Boolean
  @description("List of error messages that should be retried")
  def doRetryList: Seq[String]


end WorkerConfig

case class DefaultWorkerConfig(
    engineConfig: EngineConfig,
    workerAppPort: Int = 5555,
    identityVerification: Boolean = true,
    doRetryList: Seq[String] = Seq(
      "Entity was updated by another transaction concurrently",
      "Exception while completing the external task: Connection could not be established with message",
      "An exception occurred in the persistence layer",
      "Exception when sending request: GET", // sttp.client3.SttpClientException$ReadException
      "Exception when sending request: PUT"  // only GET and PUT to be safe a POST is not executed again
      //  "Service Unavailable",
      //  "Gateway Timeout"
    ).map(_.toLowerCase)
) extends WorkerConfig

object WorkerConfig:
  val localWorkerAppUrl = "http://localhost:5555"
