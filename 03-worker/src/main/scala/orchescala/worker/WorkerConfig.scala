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

  /** Keycloak clients whose client roles (`resource_access.{client}.roles`) count for
    * `WorkerDsl.requiredRoles` - by default none, only app roles (`roles`) and realm roles.
    */
  def roleClients: Set[String] = Set.empty

  /** The roles of the user of a Bearer token - for `WorkerDsl.requiredRoles`. Default: the role
    * claims of Keycloak and Entra ID ([[RoleClaims]]); override it for another IdP.
    *
    * It runs for every call of a worker with roles - on the blocking pool, but keep it fast (better
    * no call to the IdP). An override that asks the IdP should cache the roles per token (or per
    * subject, for the lifetime of the token) - else every call costs an IdP request and a thread.
    * If it throws or takes longer than [[rolesTimeout]], the roles cannot be checked: the call is
    * answered with 503 and the worker does not run.
    */
  def rolesOf(token: String): Set[String] = RoleClaims.fromToken(token, roleClients)

  /** How long [[rolesOf]] may take - after it the call is answered with 503.
    *
    * The answer comes in time, but an override that ignores the interrupt (e.g. a socket read
    * without its own timeout) keeps its blocking thread until it ends - during an IdP outage one
    * thread per call. Give such an override its own timeouts, a cache and if needed a circuit
    * breaker.
    */
  def rolesTimeout: zio.Duration = zio.Duration.fromSeconds(5)

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
