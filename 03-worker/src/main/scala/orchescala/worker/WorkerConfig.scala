package orchescala.worker

import orchescala.engine.auth.TokenValidation

import orchescala.engine.EngineConfig
import sttp.tapir.Schema.annotations.description

trait WorkerConfig:
  def engineConfig: EngineConfig
  def workerAppPort: Int

  @description("Flag, if `true` identity correlation is required.")
  def identityVerification: Boolean
  @description(
    """List of error messages that get 2 retries on the first failure of a task,
      |instead of the default of 0 (like ServiceError).
      |""".stripMargin)
  def doRetryList: Seq[String]

  @description(
    """How the `/worker` endpoint checks the Bearer token - `TokenValidation.Jwt` verifies it
      |(signature, expiry, issuer), `PresenceOnly` only checks that there is one.
      |""".stripMargin)
  def tokenValidation: TokenValidation = TokenValidation.PresenceOnly

  /** The largest file of the UI bundle (`/ui/`) the worker app serves, in bytes. Keep it at most
    * `GatewayConfig.uiMaxFileSize` - a bigger file passes here but is a 502 at the gateway.
    */
  def uiMaxFileSize: Long = UiRoutes.defaultMaxFileSize

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
    ).map(_.toLowerCase),
    override val tokenValidation: TokenValidation = TokenValidation.PresenceOnly
) extends WorkerConfig

object WorkerConfig:
  val localWorkerAppUrl = "http://localhost:5555"
