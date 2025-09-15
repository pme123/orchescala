package orchescala.worker

import sttp.tapir.Schema.annotations.description

case class WorkerConfig(
    @description("List of error messages that should be retried")
    doRetryList: Seq[String]
)

object WorkerConfig:
  lazy val default = WorkerConfig(doRetryList = Seq(
    "Entity was updated by another transaction concurrently",
    "Exception while completing the external task: Connection could not be established with message",
    "An exception occurred in the persistence layer",
    "Exception when sending request: GET", // sttp.client3.SttpClientException$ReadException
    "Exception when sending request: PUT" // only GET and PUT to be safe a POST is not executed again
    //  "Service Unavailable",
    //  "Gateway Timeout"
  ).map(_.toLowerCase))
end WorkerConfig
