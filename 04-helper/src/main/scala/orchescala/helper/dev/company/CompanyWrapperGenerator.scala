package orchescala.helper.dev.company

import orchescala.engine.domain.EngineType
import orchescala.helper.dev.update.{
  GenericFileGenerator,
  createIfNotExists,
  createOrUpdate,
  helperDoNotAdjustText
}
import orchescala.helper.util.*

case class CompanyWrapperGenerator()(using config: DevConfig):

  def generate(supportedEngines: Seq[EngineType]): Unit =
    println("Generate Company Wrapper")
    createIfNotExists(config.projectDir / "CHANGELOG.md", GenericFileGenerator().changeLog)
    createIfNotExists(projectDomainPath, domainWrapper)
    createIfNotExists(projectApiPath, apiWrapper)
    createIfNotExists(projectDmnPath, dmnWrapper)
    createIfNotExists(projectSimulationPath, simulationWrapper)
    createIfNotExists(projectEnginePath, engineWrapper(supportedEngines))
    if supportedEngines.contains(EngineType.C7) then
      createIfNotExists(projectEngineC7Path, engineC7Wrapper)
      createIfNotExists(projectC7SimulationPath, c7SimulationWrapper)
      createIfNotExists(projectWorkerC7ClientPath, workerCompanyC7ClientWrapper)

    if supportedEngines.contains(EngineType.C8) then
      createIfNotExists(projectEngineC8Path, engineC8Wrapper)
      createIfNotExists(projectC8SimulationPath, c8SimulationWrapper)

    createIfNotExists(projectWorkerPath, workerWrapper)
    createIfNotExists(projectWorkerContextPath, workerContextWrapper)
    // createIfNotExists(projectWorkerPasswordPath, workerPasswordWrapper)
    createIfNotExists(projectWorkerRestApiPath, workerRestApiWrapper)
    createIfNotExists(projectWorkerAppPath, workerAppWrapper)
    createIfNotExists(projectGatewayPath, gatewayServerWrapper)
    createIfNotExists(helperCompanyDevHelperPath, helperCompanyDevHelperWrapper)
    createIfNotExists(helperCompanyDevConfigPath, helperCompanyDevConfigWrapper)
    createIfNotExists(helperCompanyOrchescalaDevHelperPath, helperCompanyOrchescalaDevHelperWrapper)
    // the former Redoc CompanyOpenApi.html resource is gone - the API page is orch-doc's
    // OrchDocApi.html, built by DevCompanyOrchescalaHelper.update (PublishConfig.apiDocPath)
    os.remove(helperCompanyOpenApiHtmlPath)
  end generate

  private lazy val companyName     = config.companyName
  private lazy val companyNameNice = s"${config.companyName.head.toUpper}${config.companyName.tail}"

  private lazy val projectDomainPath                    = ModuleConfig.domainModule.srcPath / "CompanyBpmnDsl.scala"
  private lazy val projectEnginePath                    = ModuleConfig.engineModule.srcPath / "CompanyEngineConfig.scala"
  // Camunda 7
  private lazy val projectEngineC7Path                  =
    ModuleConfig.engineModule.srcPath / "CompanyEngineC7Config.scala"
  private lazy val projectEngineC8Path                  =
    ModuleConfig.engineModule.srcPath / "CompanyEngineC8Config.scala"
  private lazy val projectApiPath                       = ModuleConfig.apiModule.srcPath / "CompanyApiCreator.scala"
  private lazy val projectDmnPath                       = ModuleConfig.dmnModule.srcPath / "CompanyDmnTester.scala"
  private lazy val projectSimulationPath                =
    ModuleConfig.simulationModule.srcPath / "CompanySimulation.scala"
  private lazy val projectC8SimulationPath              =
    ModuleConfig.simulationModule.srcPath / "CompanyC8Simulation.scala"
  private lazy val projectC7SimulationPath              =
    ModuleConfig.simulationModule.srcPath / "CompanyC7Simulation.scala"
  private lazy val projectWorkerPath                    = ModuleConfig.workerModule.srcPath / "CompanyWorker.scala"
  private lazy val projectWorkerContextPath             =
    ModuleConfig.workerModule.srcPath / "CompanyEngineContext.scala"
  private lazy val projectWorkerPasswordPath            =
    ModuleConfig.workerModule.srcPath / "CompanyPasswordFlow.scala"
  private lazy val projectWorkerRestApiPath             =
    ModuleConfig.workerModule.srcPath / "CompanyRestApiClient.scala"
  private lazy val projectWorkerAppPath                 =
    ModuleConfig.workerModule.srcPath / "CompanyWorkerApp.scala"
  private lazy val projectWorkerC7ClientPath            =
    ModuleConfig.workerModule.srcPath / "CompanyC7Client.scala"
  private lazy val projectGatewayPath                   =
    ModuleConfig.gatewayModule.srcPath / "GatewayServerApp.scala"
  private lazy val helperCompanyDevHelperPath           =
    ModuleConfig.helperModule.srcPath / "CompanyDevHelper.scala"
  private lazy val helperCompanyDevConfigPath           =
    ModuleConfig.helperModule.srcPath / "CompanyDevConfig.scala"
  private lazy val helperCompanyOrchescalaDevHelperPath =
    ModuleConfig.helperModule.srcPath / "CompanyOrchescalaDevHelper.scala"
  private lazy val helperCompanyOpenApiHtmlPath         =
    ModuleConfig.helperModule.resourcePath / "CompanyOpenApi.html"

  private lazy val domainWrapper =
    s"""package $companyName.orchescala.domain
       |
       |/**
       | * Add here company specific stuff, like documentation or custom elements.
       | */
       |trait CompanyBpmnDsl extends BpmnDsl:
       |  // override def companyDescr = ??? //TODO Add your specific Company Description!
       |end CompanyBpmnDsl
       |
       |trait CompanyBpmnProcessDsl extends BpmnProcessDsl, CompanyBpmnDsl
       |trait CompanyBpmnServiceTaskDsl extends BpmnServiceTaskDsl, CompanyBpmnDsl
       |trait CompanyBpmnCustomTaskDsl extends BpmnCustomTaskDsl, CompanyBpmnDsl
       |trait CompanyBpmnDecisionDsl extends BpmnDecisionDsl, CompanyBpmnDsl
       |trait CompanyBpmnUserTaskDsl extends BpmnUserTaskDsl, CompanyBpmnDsl
       |trait CompanyBpmnMessageEventDsl extends BpmnMessageEventDsl, CompanyBpmnDsl
       |trait CompanyBpmnSignalEventDsl extends BpmnSignalEventDsl, CompanyBpmnDsl
       |trait CompanyBpmnTimerEventDsl extends BpmnTimerEventDsl, CompanyBpmnDsl
       |""".stripMargin

  private def engineWrapper(supportedEngines: Seq[EngineType]) =
    s"""package $companyName.orchescala
       |package engine
       |
       |object CompanyEngineConfig extends ${supportedEngines.map(t => s"CompanyEngine${t}Config").mkString(", ")}
       |
       |""".stripMargin

  private lazy val engineC7Wrapper =
    s"""package $companyName.orchescala
       |package engine
       |
       |/**
       | * Add here company specific stuff, to configure the Engine.
       | */
       |object CompanyEngineC7Config:
       |
       |  lazy val ssoClientName = sys.env.getOrElse("SSO_CLIENT_NAME", "myClient")
       |  lazy val ssoClientSecret =
       |    sys.env.getOrElse("SSO_CLIENT_SECRET", "mySecret")
       |  lazy val ssoScope = sys.env.getOrElse("SSO_SCOPE", "myScope")
       |
       |  lazy val ssoTechuserName = sys.env.getOrElse("SSO_TECHUSER_NAME", "admin")
       |  lazy val ssoTechuserPassword = sys.env.getOrElse("SSO_TECHUSER_PASSWORD", "admin")
       |
       |
       |  lazy val ssoRealm: String = sys.env.getOrElse("SSO_REALM", "MY_REALM")
       |  lazy val ssoBaseUrl = sys.env.getOrElse("SSO_BASE_URL", s"http://host.lima.internal:8090")
       |  lazy val camundaRestUrl = sys.env.getOrElse("CAMUNDA_BASE_URL", "http://localhost:8080/engine-rest")
       |
       |  lazy val client_id = ssoClientName
       |  lazy val client_secret = ssoClientSecret
       |  lazy val scope = ssoScope
       |  lazy val username = ssoTechuserName
       |  lazy val password = ssoTechuserPassword
       |
       |end CompanyEngineC7Config
       |""".stripMargin

  private lazy val engineC8Wrapper =
    s"""package $companyName.orchescala.engine
       |
       |import orchescala.engine.EngineConfig
       |import orchescala.engine.c8.C8SaasClient
       |
       |/**
       | * Company-specific C8 Engine Configuration that provides EngineConfig and C8 SaaS client settings
       | */
       |trait CompanyEngineC8Config extends C8SaasClient:
       |
       |  // Provide EngineConfig as a given instance
       |  given EngineConfig = EngineConfig(
       |    tenantId = None // TODO: Set your tenant ID if needed
       |  )
       |
       |  // C8 SaaS Configuration - override these values in your implementation or use environment variables
       |  protected def zeebeGrpc: String = sys.env.getOrElse("ZEEBE_GRPC_ADDRESS", "https://bru-2.zeebe.camunda.io:443")
       |  protected def zeebeRest: String = sys.env.getOrElse("ZEEBE_REST_ADDRESS", "https://bru-2.zeebe.camunda.io")
       |  protected def audience: String = sys.env.getOrElse("ZEEBE_AUDIENCE", "zeebe.camunda.io")
       |  protected def clientId: String = sys.env.getOrElse("ZEEBE_CLIENT_ID", "your-client-id")
       |  protected def clientSecret: String = sys.env.getOrElse("ZEEBE_CLIENT_SECRET", "your-client-secret")
       |  protected def oAuthAPI: String = sys.env.getOrElse("ZEEBE_OAUTH_URL", "https://login.cloud.camunda.io/oauth/token")
       |
       |  // Convenience method to access the EngineConfig
       |  def engineConfig: EngineConfig = summon[EngineConfig]
       |
       |end CompanyEngineC8Config
       |""".stripMargin

  private lazy val apiWrapper =
    s"""package $companyName.orchescala
       |package api
       |
       |import orchescala.engine.DefaultEngineConfig
       |
       |/**
       | * Add here company specific stuff, to create the Api documentation and the Postman collection.
       | */
       |trait CompanyApiCreator extends ApiCreator, ApiDsl, CamundaPostmanApiCreator:
       |
       |  // override the config if needed
       |  protected def apiConfig: ApiConfig = CompanyApiCreator.apiConfig
       |
       |  lazy val companyProjectVersion = BuildInfo.version
       |
       |object CompanyApiCreator:
       |   lazy val apiConfig = ApiConfig(
       |     engineConfig = DefaultEngineConfig(),
       |     companyName = "$companyName"
       |   )
       |""".stripMargin

  private lazy val dmnWrapper =
    s"""package $companyName.orchescala.dmn
       |
       |trait CompanyDmnTester extends DmnTesterApp:
       |
       |  override protected def starterConfig: DmnTesterStarterConfig =
       |    DmnTesterStarterConfig(companyName = "$companyName")
       |    // Where the DMNs of a project are - name the sources if your
       |    // projects have DMNs of more than one platform. A decision is then
       |    // looked up in every source and tested against all of them:
       |    //
       |    // DmnTesterStarterConfig(
       |    //   companyName = "$companyName",
       |    //   dmnSources = Seq(
       |    //     DmnSource("c7", projectBasePath / "src" / "main" / "resources" / "camunda"),
       |    //     DmnSource("c8", projectBasePath / "c8" / "src" / "main" / "resources")
       |    //   )
       |    // )
       |
       |end CompanyDmnTester
       |""".stripMargin

  private lazy val simulationWrapper =
    s"""package $companyName.orchescala.simulation
       |
       |
       |/**
       | * Add here company specific stuff, to run the Simulations.
       | */
       |trait CompanySimulation extends SimulationRunner:
       |
       |  override def config =
       |    super.config //TODO Adjust config if needed
       |
       |end CompanySimulation
       |""".stripMargin

  private lazy val c8SimulationWrapper =
    s"""package $companyName.orchescala.simulation
       |
       |import io.camunda.client.CamundaClient
       |import orchescala.engine.{EngineError, EngineConfig, ProcessEngine}
       |import orchescala.engine.c8.{C8ProcessEngine, C8SaasClient, SharedC8ClientManager}
       |import orchescala.simulation.{SimulationConfig, SimulationRunner, SimulationError, LogLevel, ScenarioResult}
       |import zio.{ZIO, Scope, ZLayer}
       |
       |/**
       | * Company-specific C8 Simulation trait that works with SharedC8ClientManager
       | */
       |trait CompanyC8Simulation extends SimulationRunner, CompanyEngineC8Config, C8SaasClient:
       |
       |  // Provide the client as a given for the engine services
       |  given ZIO[SharedC8ClientManager, EngineError, CamundaClient] = client
       |
       |  // Override requiredLayers to provide the SharedC8ClientManager layer
       |  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
       |    Seq(SharedC8ClientManager.layer)
       |
       |  // Override engineZIO to create the engine within the SharedC8ClientManager environment
       |  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
       |    C8ProcessEngine.withClient(this).provideLayer(SharedC8ClientManager.layer)
       |
       |  // No special cleanup needed - the SharedC8ClientManager layer handles it
       |  def engineCleanupFinalizer: ZIO[Scope, Nothing, Any] =
       |    ZIO.unit
       |
       |  override lazy val config: SimulationConfig =
       |    SimulationConfig(
       |      endpoint = zeebeRest
       |    )
       |
       |end CompanyC8Simulation
       |""".stripMargin

  private lazy val c7SimulationWrapper =
    s"""package $companyName.orchescala.simulation
       |
       |import org.camunda.community.rest.client.invoker.ApiClient
       |import orchescala.engine.{EngineError, EngineConfig, ProcessEngine}
       |import orchescala.engine.c7.{C7ProcessEngine, C7LocalClient, SharedC7ClientManager}
       |import orchescala.simulation.{SimulationConfig, SimulationRunner, SimulationError, LogLevel, ScenarioResult}
       |import zio.{ZIO, Scope, ZLayer}
       |
       |/**
       | * Company-specific C7 Simulation trait that works with SharedC7ClientManager
       | */
       |trait CompanyC7Simulation extends SimulationRunner, CompanyEngineC7Config, C7LocalClient:
       |
       |  // Override requiredLayers to provide the SharedC7ClientManager layer
       |  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
       |    Seq(SharedC7ClientManager.layer)
       |
       |  // Override engineZIO to create the engine within the SharedC7ClientManager environment
       |  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
       |    C7ProcessEngine.withClient(this).provideLayer(SharedC7ClientManager.layer)
       |
       |  // No special cleanup needed - the SharedC7ClientManager layer handles it
       |  def engineCleanupFinalizer: ZIO[Scope, Nothing, Any] =
       |    ZIO.unit
       |
       |  override lazy val config: SimulationConfig =
       |    SimulationConfig(
       |      endpoint = camundaRestUrl
       |    )
       |
       |end CompanyC7Simulation
       |""".stripMargin

  private lazy val workerWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import orchescala.worker.c7.{C7Context, C7Worker}
       |//import orchescala.worker.c8.{C8Context, C8Worker}
       |import $companyName.orchescala.worker.*
       |
       |import scala.reflect.ClassTag
       |
       |/**
       | * Add here company specific stuff, to run the Workers.
       | * You also define the implementation of the Worker here.
       | */
       |trait CompanyWorker[In <: Product : InOutCodec, Out <: Product : InOutCodec]
       |  extends C7Worker[In, Out]/*, C8Worker[In, Out]*/:
       |  protected def c7Context: C7Context = CompanyEngineContext(CompanyRestApiClient())
       |//  protected def c8Context: C8Context = CompanyEngineContext(CompanyRestApiClient())
       |
       |trait CompanyValidationWorkerDsl[
       |    In <: Product: InOutCodec
       |] extends CompanyWorker[In, NoOutput], ValidationWorkerDsl[In]
       |
       |trait CompanyInitWorkerDsl[
       |    In <: Product: InOutCodec,
       |    Out <: Product: InOutCodec,
       |    InitIn <: Product: InOutCodec,
       |    InConfig <: Product: InOutCodec
       |] extends CompanyWorker[In, Out], InitWorkerDsl[In, Out, InitIn, InConfig]
       |
       |trait CompanyCustomWorkerDsl[
       |    In <: Product: InOutCodec,
       |    Out <: Product: InOutCodec
       |] extends CompanyWorker[In, Out], CustomWorkerDsl[In, Out]
       |
       |trait CompanyServiceWorkerDsl[
       |    In <: Product: InOutCodec,
       |    Out <: Product: InOutCodec,
       |    ServiceIn: InOutEncoder,
       |    ServiceOut: {InOutDecoder, ClassTag}
       |] extends CompanyWorker[In, Out], ServiceWorkerDsl[In, Out, ServiceIn, ServiceOut]
       |""".stripMargin

  private lazy val workerContextWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import orchescala.worker.c7.C7Context
       |import scala.reflect.ClassTag
       |
       |class CompanyEngineContext(restApiClient: CompanyRestApiClient) extends C7Context:
       |
       |
       |  override def sendRequest[ServiceIn: Encoder, ServiceOut: {Decoder, ClassTag}](
       |      request: RunnableRequest[ServiceIn]
       |  ): SendRequestType[ServiceOut] =
       |    restApiClient.sendRequest(request)
       |
       |end CompanyEngineContext
       |""".stripMargin

  private lazy val workerPasswordWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import orchescala.worker.c7.OAuth2WorkerClient
       |import $companyName.orchescala.engine.CompanyEngineC7Config
       |
       |trait CompanyPasswordFlow extends OAuth2WorkerClient:
       |
       |  def ssoRealm: String = CompanyEngineC7Config.ssoRealm
       |  def ssoBaseUrl: String = CompanyEngineC7Config.ssoBaseUrl
       |
       | // override the config if needed or change the WorkerClient
       |
       |end CompanyPasswordFlow
       |""".stripMargin

  private lazy val workerRestApiWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import orchescala.worker.WorkerError.ServiceAuthError
       |import sttp.client3.*
       |
       |class CompanyRestApiClient extends RestApiClient, CompanyPasswordFlow:
       |
       |  override protected def auth(
       |      request: Request[Either[String, String], Any]
       |  )(using
       |      context: EngineRunContext
       |  ): IO[ServiceAuthError, Request[Either[String, String], Any]] = ???
       |
       |  end auth
       |
       |end CompanyRestApiClient
       |""".stripMargin

  private lazy val workerAppWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import orchescala.worker.c7.C7WorkerRegistry
       |import orchescala.worker.c8.C8WorkerRegistry
       |import orchescala.engine.c8.SharedC8ClientManager
       |import zio.ZLayer
       |
       |trait CompanyWorkerApp extends WorkerApp:
       |
       |  // For C7 only
       |  lazy val workerRegistriesC7: Seq[WorkerRegistry] =
       |    Seq(C7WorkerRegistry(CompanyC7Client))
       |
       |  // For C8 only
       |  lazy val workerRegistriesC8: Seq[WorkerRegistry] =
       |    Seq(C8WorkerRegistry(CompanyC8Client))
       |
       |  // Override additionalLayers when using C8 workers
       |  override def additionalLayers: ZLayer[Any, Nothing, Any] =
       |    if workerRegistries.exists(_.isInstanceOf[C8WorkerRegistry]) then
       |      SharedC8ClientManager.layer
       |    else
       |      ZLayer.empty
       |
       |  // Choose which registries to use based on your Camunda version
       |  lazy val workerRegistries: Seq[WorkerRegistry] = workerRegistriesC7 // or workerRegistriesC8
       |""".stripMargin

  private lazy val workerCompanyC7ClientWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import democompany.orchescala.engine.CompanyEngineC7Config
       |import orchescala.worker.c7.OAuth2WorkerClient
       |import scala.concurrent.duration.*
       |
       |trait CompanyC7Client extends OAuth2WorkerClient:
       |  lazy val ssoRealm = CompanyEngineC7Config.ssoRealm
       |  lazy val ssoBaseUrl = CompanyEngineC7Config.ssoBaseUrl
       |  override lazy val camundaRestUrl = CompanyEngineC7Config.camundaRestUrl
       |  override lazy val client_id = CompanyEngineC7Config.ssoClientName
       |  override lazy val client_secret = CompanyEngineC7Config.ssoClientSecret
       |  override lazy val scope = CompanyEngineC7Config.ssoScope
       |  override lazy val username = CompanyEngineC7Config.ssoTechuserName
       |  override lazy val password = CompanyEngineC7Config.ssoTechuserPassword
       |
       |  override lazy val lockDuration: Long = 5.minutes.toMillis
       |
       |end CompanyC7Client
       |
       |object CompanyC7Client extends CompanyC7Client
       |""".stripMargin

  private lazy val gatewayServerWrapper          =
    s"""package $companyName.orchescala.gateway
       |
       |import orchescala.engine.c7.{C7DefaultBearerTokenClient, C7ProcessEngine, SharedC7ClientManager}
       |import orchescala.engine.gateway.GProcessEngine
       |import orchescala.engine.{EngineConfig, ProcessEngine}
       |import $companyName.orchescala.engine.{CompanyEngineConfig, CompanyEngineGApp}
       |import $companyName.orchescala.worker.CompanyWorker.companyWorkerConfig
       |import zio.ZIO
       |
       |// sbt gateway/run
       |object GatewayServerApp
       |    extends GatewayServer, CompanyEngineGApp, CompanyEngineConfig:
       |
       |  given EngineConfig = engineConfig
       |    .copy(
       |      validateInput = true
       |    )
       |
       |  override lazy val config: GatewayConfig =
       |    DefaultGatewayConfig(
       |      engineConfig = engineConfig,
       |      workerConfig = companyWorkerConfig,
       |      docsAuth = authCode
       |    )
       |
       |  /** Example C7 client with Bearer token pass-through authentication */
       |  lazy val c7Client = C7DefaultBearerTokenClient:
       |    camundaRestUrl
       |
       |  // Override engineZIO to create the engine within the SharedC8ClientManager environment
       |  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
       |    (for
       |      c7Engine: ProcessEngine <- C7ProcessEngine.withClient(c7Client)
       |      given Seq[ProcessEngine] =
       |        Seq(c7Engine) // -> change order to change default engine
       |    yield GProcessEngine())
       |      .provideLayer(SharedC7ClientManager.layer)
       |
       |  private def authCode =
       |      DocsAuth.OAuth2AuthCode(
       |        ssoBaseUrl = ssoBaseUrl,
       |        realm = ssoRealm,
       |        clientId = ssoClientId,
       |        clientSecret = ssoClientSecret,
       |        scopes = ssoScope
       |      )
       |
       |end GatewayServerApp""".stripMargin
  private lazy val helperCompanyDevHelperWrapper =
    s"""package $companyName.orchescala.helper
       |
       |import orchescala.api.ApiConfig
       |import orchescala.helper.dev.DevHelper
       |import orchescala.helper.util.DevConfig
       |import $companyName.orchescala.api.CompanyApiCreator
       |
       |case object CompanyDevHelper
       |    extends DevHelper:
       |
       |  lazy val apiConfig: ApiConfig = CompanyApiCreator.apiConfig
       |  lazy val devConfig: DevConfig = CompanyDevConfig.config
       |
       |end CompanyDevHelper
       |""".stripMargin
  end helperCompanyDevHelperWrapper

  private lazy val helperCompanyDevConfigWrapper           =
    s"""package $companyName.orchescala.helper
       |
       |import orchescala.api.*
       |import orchescala.helper.util.*
       |import $companyName.orchescala.BuildInfo
       |
       |object CompanyDevConfig:
       |
       |  lazy val companyConfig =
       |    DevConfig(
       |      ApiProjectConfig(
       |        projectName = BuildInfo.name,
       |        projectVersion = BuildInfo.version
       |      )
       |    )
       |
       |  lazy val config: DevConfig =
       |     config(ApiProjectConfig())
       |     
       |  def config(apiProjectConfig: ApiProjectConfig) = DevConfig(
       |    apiProjectConfig,
       |    //sbtConfig = companySbtConfig,
       |    //versionConfig = companyVersionConfig,
       |    //publishConfig = Some(companyPublishConfig),
       |    //postmanConfig = Some(companyPostmanConfig),
       |    //dockerConfig = companyDockerConfig
       |  )
       |
       |  private lazy val companyVersionConfig = CompanyVersionConfig(
       |    scalaVersion = BuildInfo.scalaVersion,
       |    orchescalaVersion = BuildInfo.orchescalaV,
       |    companyOrchescalaVersion = BuildInfo.version,
       |    sbtVersion = BuildInfo.sbtVersion,
       |    otherVersions = Map()
       |  )
       |end CompanyDevConfig
       |""".stripMargin
  end helperCompanyDevConfigWrapper
  private lazy val helperCompanyOrchescalaDevHelperWrapper =
    s"""package $companyName.orchescala.helper
       |
       |import orchescala.api.ApiConfig
       |import orchescala.helper.dev.DevCompanyOrchescalaHelper
       |import orchescala.helper.util.DevConfig
       |import $companyName.orchescala.BuildInfo
       |import $companyName.orchescala.api.CompanyApiCreator
       |
       |object CompanyOrchescalaDevHelper
       |    extends DevCompanyOrchescalaHelper:
       |
       |  lazy val apiConfig: ApiConfig = CompanyApiCreator.apiConfig
       |    .copy(
       |      basePath = os.pwd / "00-docs",
       |      tempGitDir = os.pwd / os.up /  os.up / "git-temp"
       |    )
       |
       |  lazy val devConfig: DevConfig = CompanyDevConfig.companyConfig
       |
       |end CompanyOrchescalaDevHelper
       |""".stripMargin
  end helperCompanyOrchescalaDevHelperWrapper


  extension (module: ModuleConfig)
    def srcPath: os.Path      =
      config.projectDir / module.packagePath(
        config.projectPath
      )
    def resourcePath: os.Path =
      config.projectDir / module.packagePath(
        config.projectPath,
        isSourceDir = false
      )
  end extension
end CompanyWrapperGenerator
