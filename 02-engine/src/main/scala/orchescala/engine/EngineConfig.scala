package orchescala.engine

import orchescala.domain.*
import orchescala.engine.rest.WorkerForwardUtil

trait EngineConfig:
  def tenantId: Option[String]
  @description(
    "The key of the process variable that contains an additional value to verify the impersonate User"
  )
  def impersonateProcessKey: Option[String]
  @description(
    "Secret key for signing IdentityCorrelation (HMAC-SHA256). Should be set from environment variable."
  )
  def identitySigningKey: Option[String]

  @description(
    """Get the base URL for a worker app by topic name. Returns None if the worker should be executed
      |locally. Returns Some(url) if the worker request should be forwarded to the given URL.
      |""".stripMargin)
  def workerAppUrl: (topicName: String) => Option[String]

  @description(
    """Validate input variables before starting a process instance.
      |If true the input is validated before starting the process.
      |If the validation fails the process is not even started and a 400 is returned.
      |""".stripMargin
  )
  def validateInput: Boolean

  @description(
    """Parallelism limit for concurrent fiber execution in parallel operations.
      |Controls how many workers, simulations, and API operations run concurrently.
      |Default: 4 concurrent fibers
      |""".stripMargin
  )
  def parallelism: Int

  def validateProcess(doValidate: Boolean): EngineConfig

  def withTenantId(tenantId: String): EngineConfig 

end EngineConfig

case class DefaultEngineConfig(
    tenantId: Option[String] = None,
    impersonateProcessKey: Option[String] = None,
    identitySigningKey: Option[String] = sys.env.get("ORCHESCALA_IDENTITY_SIGNING_KEY"),
    validateInput: Boolean = true,
    parallelism: Int = 4,
    workerAppUrl: (topicName: String) => Option[String] = (topicName) => WorkerForwardUtil.defaultWorkerAppUrl(topicName, WorkerForwardUtil.localWorkerAppUrl)
) extends EngineConfig:
  
  def validateProcess(doValidate: Boolean): EngineConfig =
    copy(validateInput = doValidate)

  def withTenantId(tenantId: String): EngineConfig =
    copy(tenantId = Some(tenantId))

end DefaultEngineConfig
