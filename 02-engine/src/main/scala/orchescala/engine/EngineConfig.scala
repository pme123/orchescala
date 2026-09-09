package orchescala.engine

import orchescala.domain.*
import orchescala.engine.config.ReposConfig
import orchescala.engine.domain.EngineType
import orchescala.engine.rest.WorkerForwardUtil

import java.net.URI
import java.nio.file.Paths

trait EngineConfig:
  def tenantId: Option[String]
  @description(
    "The engines that you support"
  )
  def supportedEngines: Seq[EngineType]
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
      |""".stripMargin
  )
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

  @description(
    """General repository configuration (release/dependency repos).""".stripMargin
  )
  def reposConfig: ReposConfig

  @description(
    """Repositories where deployment artifacts (jars) are resolved from.
      |Defaults to the local Maven repository (~/.m2/repository) and Maven Central.
      |""".stripMargin
  )
  def deploymentRepositories: Seq[URI] =
    reposConfig.deploymentRepositories match
      case Seq() =>
        Seq(
          Paths.get(System.getProperty("user.home"), ".m2", "repository").toUri,
          URI.create("https://repo1.maven.org/maven2")
        )
      case repos => repos

  @description(
    """Pattern used to build the artifact URI inside a repository.
      |Supported placeholders: <repo>, <company>, <project>, <version>, <artifact>.
      |""".stripMargin
  )
  def deploymentArtifactPattern: String = reposConfig.deploymentArtifactPattern

  def validateProcess(doValidate: Boolean): EngineConfig

  def withTenantId(tenantId: String): EngineConfig

end EngineConfig

case class DefaultEngineConfig(
    tenantId: Option[String] = None,
    supportedEngines: Seq[EngineType] = Seq(EngineType.C7),
    impersonateProcessKey: Option[String] = None,
    identitySigningKey: Option[String] = sys.env.get("ORCHESCALA_IDENTITY_SIGNING_KEY"),
    validateInput: Boolean = true,
    parallelism: Int = 4,
    workerAppUrl: (topicName: String) => Option[String] = topicName =>
      Some(
        s"http://${
            if EnvironmentDetector.isLocalhost then "localhost"
            else topicName.split('-').take(2).mkString("-")
          }:5555"
      ),
    reposConfig: ReposConfig = ReposConfig.dummyRepos
) extends EngineConfig:

  def validateProcess(doValidate: Boolean): EngineConfig =
    copy(validateInput = doValidate)

  def withTenantId(tenantId: String): EngineConfig =
    copy(tenantId = Some(tenantId))

end DefaultEngineConfig
