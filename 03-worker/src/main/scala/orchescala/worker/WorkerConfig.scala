package orchescala.worker

import sttp.tapir.Schema.annotations.description

trait WorkerConfig:
  def workerAppPort: Int
  @description("List of error messages that should be retried")
  def doRetryList: Seq[String]

end WorkerConfig

case class DefaultWorkerConfig(
    workerAppPort: Int = 5555,
    workersBasePath: String = WorkerConfig.localWorkerAppUrl,
    doRetryList: Seq[String] = Seq(
      "Entity was updated by another transaction concurrently",
      "Exception while completing the external task: Connection could not be established with message",
      "An exception occurred in the persistence layer",
      "Exception when sending request: GET", // sttp.client3.SttpClientException$ReadException
      "Exception when sending request: PUT"  // only GET and PUT to be safe a POST is not executed again
      //  "Service Unavailable",
      //  "Gateway Timeout"
    ).map(_.toLowerCase),
    workerAppUrl: Option[String] = None
) extends WorkerConfig

object WorkerConfig:
  val localWorkerAppUrl = "http://localhost:5555"
