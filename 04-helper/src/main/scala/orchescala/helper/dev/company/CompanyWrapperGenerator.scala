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
    // the company wrappers support Camunda 7 and 8 - in the order of the supported engines
    val engines = supportedEngines.filter(Seq(EngineType.C7, EngineType.C8).contains).distinct
    createIfNotExists(config.projectDir / "CHANGELOG.md", GenericFileGenerator().changeLog)
    createIfNotExists(projectDomainPath, domainWrapper)
    createIfNotExists(projectApiPath, apiWrapper)
    createIfNotExists(projectDmnPath, dmnWrapper)
    createIfNotExists(projectEnginePath, engineWrapper(engines))
    createIfNotExists(projectEngineGAppPath, engineGAppWrapper(engines))
    createIfNotExists(projectSimulationPath, simulationWrapper(engines))
    if engines.contains(EngineType.C7) then
      createIfNotExists(projectEngineC7Path, engineC7Wrapper)
      createIfNotExists(projectEngineC7AppPath, engineC7AppWrapper)
      createIfNotExists(projectC7SimulationPath, c7SimulationWrapper)
      createIfNotExists(projectWorkerContextPath, workerContextWrapper)
      createIfNotExists(projectWorkerC7ClientPath, workerCompanyC7ClientWrapper)

    if engines.contains(EngineType.C8) then
      createIfNotExists(projectEngineC8Path, engineC8Wrapper)
      createIfNotExists(projectEngineC8AppPath, engineC8AppWrapper)
      createIfNotExists(projectC8SimulationPath, c8SimulationWrapper)
      createIfNotExists(projectWorkerC8ContextPath, workerC8ContextWrapper)
      createIfNotExists(projectWorkerC8ClientPath, workerCompanyC8ClientWrapper)

    createIfNotExists(projectWorkerPath, workerWrapper(engines))
    createIfNotExists(projectWorkerRestApiPath, workerRestApiWrapper)
    createIfNotExists(projectWorkerAppPath, workerAppWrapper(engines))
    createIfNotExists(projectGatewayPath, gatewayServerWrapper(engines))
    createIfNotExists(helperCompanyDevHelperPath, helperCompanyDevHelperWrapper)
    createIfNotExists(helperCompanyDevConfigPath, helperCompanyDevConfigWrapper)
    createIfNotExists(helperCompanyOrchescalaDevHelperPath, helperCompanyOrchescalaDevHelperWrapper)
    // the former Redoc CompanyOpenApi.html resource is gone - the API page is orch-doc's
    // OrchDocApi.html from the orchescala-orch-doc jar
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
  private lazy val projectEngineC7AppPath               =
    ModuleConfig.engineModule.srcPath / "CompanyEngineC7App.scala"
  private lazy val projectEngineC8AppPath               =
    ModuleConfig.engineModule.srcPath / "CompanyEngineC8App.scala"
  private lazy val projectEngineGAppPath                =
    ModuleConfig.engineModule.srcPath / "CompanyEngineGApp.scala"
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
  private lazy val projectWorkerC8ContextPath           =
    ModuleConfig.workerModule.srcPath / "CompanyEngineC8Context.scala"
  private lazy val projectWorkerRestApiPath             =
    ModuleConfig.workerModule.srcPath / "CompanyRestApiClient.scala"
  private lazy val projectWorkerAppPath                 =
    ModuleConfig.workerModule.srcPath / "CompanyWorkerApp.scala"
  private lazy val projectWorkerC7ClientPath            =
    ModuleConfig.workerModule.srcPath / "CompanyC7Client.scala"
  private lazy val projectWorkerC8ClientPath            =
    ModuleConfig.workerModule.srcPath / "CompanyC8Client.scala"
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

  private def engineName(engine: EngineType): String = engine.toString.toLowerCase

  private def engineWrapper(engines: Seq[EngineType]) =
    s"""package $companyName.orchescala.engine
       |
       |import orchescala.engine.auth.TokenValidation
       |import orchescala.engine.domain.EngineType
       |import orchescala.engine.rest.OAuthConfig
       |
       |/** Company wide engine settings - shared by the engine specific configs
       |  * (${engines.map(e => s"CompanyEngine${e}Config").mkString(", ")}).
       |  * Adjust the defaults or set the environment variables.
       |  */
       |trait CompanyEngineConfig:
       |
       |  def engineConfig: DefaultEngineConfig = DefaultEngineConfig(
       |    tenantId = None, // TODO set your tenant ID if needed
       |    // the first engine is the default engine of the gateway
       |    supportedEngines = Seq(${engines.map(e => s"EngineType.$e").mkString(", ")})
       |    // identitySigningKey (signs the IdentityCorrelation): env ORCHESCALA_IDENTITY_SIGNING_KEY
       |  )
       |
       |  // Identity provider (Keycloak)
       |  lazy val ssoRealm: String   = CompanyEngineConfig.ssoRealm
       |  lazy val ssoBaseUrl: String = CompanyEngineConfig.ssoBaseUrl
       |  lazy val ssoClientId        = sys.env.getOrElse("SSO_CLIENT_ID", "my-client")
       |  lazy val ssoClientSecret    = sys.env.getOrElse("SSO_CLIENT_SECRET", "NOT-SET")
       |  lazy val ssoScope           = sys.env.getOrElse("SSO_SCOPE", "openid")
       |  lazy val ssoTechuserName    = sys.env.getOrElse("SSO_TECHUSER_NAME", "admin")
       |  private[engine] lazy val ssoTechuserPassword =
       |    sys.env.getOrElse("SSO_TECHUSER_PASSWORD", "NOT-SET")
       |
       |  /** Service account - e.g. the engine services and the simulations' login for the worker app. */
       |  lazy val clientCredentials: OAuthConfig.ClientCredentials =
       |    OAuthConfig.ClientCredentials(
       |      ssoRealm = ssoRealm,
       |      ssoBaseUrl = ssoBaseUrl,
       |      client_id = ssoClientId,
       |      client_secret = ssoClientSecret,
       |      scope = ssoScope
       |    )
       |
       |  /** Technical user - e.g. the Camunda 7 external task client. */
       |  lazy val adminPasswordGrant: OAuthConfig.PasswordGrant =
       |    OAuthConfig.PasswordGrant(
       |      ssoRealm = ssoRealm,
       |      ssoBaseUrl = ssoBaseUrl,
       |      client_id = ssoClientId,
       |      client_secret = ssoClientSecret,
       |      scope = ssoScope,
       |      username = ssoTechuserName,
       |      password = ssoTechuserPassword
       |    )
       |
       |  /** How the gateway and the worker app verify the Bearer tokens of their callers. */
       |  lazy val tokenValidation: TokenValidation = CompanyEngineConfig.tokenValidation
       |
       |end CompanyEngineConfig
       |
       |object CompanyEngineConfig:
       |
       |  lazy val ssoRealm: String   = sys.env.getOrElse("SSO_REALM", "my-realm")
       |  lazy val ssoBaseUrl: String = sys.env.getOrElse("SSO_BASE_URL", "http://localhost:8090/auth")
       |
       |  // the issuer must be exactly the `iss` of the tokens - otherwise use
       |  // TokenValidation.Jwt(issuer, jwksUrl = Some(...)); tokens from several identity providers:
       |  // TokenValidation.AnyOf(jwtA, jwtB)
       |  lazy val tokenValidation: TokenValidation = TokenValidation.keycloak(ssoBaseUrl, ssoRealm)
       |
       |end CompanyEngineConfig
       |""".stripMargin

  private lazy val engineC7Wrapper =
    s"""package $companyName.orchescala.engine
       |
       |/** Camunda 7 settings. */
       |trait CompanyEngineC7Config extends CompanyEngineConfig:
       |
       |  lazy val c7RestUrl: String =
       |    sys.env.getOrElse("CAMUNDA_BASE_URL", "http://localhost:8080/engine-rest")
       |  lazy val c7CockpitUrl: String =
       |    sys.env.getOrElse("CAMUNDA_COCKPIT_URL", ProcessEngine.c7CockpitUrl)
       |
       |end CompanyEngineC7Config
       |
       |object CompanyEngineC7Config extends CompanyEngineC7Config
       |""".stripMargin

  private lazy val engineC7AppWrapper =
    s"""package $companyName.orchescala.engine
       |
       |import orchescala.engine.c7.{C7OAuth2Client, C7ProcessEngine, SharedC7ClientManager}
       |import orchescala.engine.rest.OAuthConfig
       |import zio.{ZIO, ZLayer}
       |
       |/** The Camunda 7 engine - the engine services authenticate with the service account. */
       |object CompanyEngineC7App extends EngineApp, CompanyEngineC7Config, C7OAuth2Client:
       |
       |  lazy val camundaRestUrl: String                 = c7RestUrl
       |  def oAuthConfig: OAuthConfig.ClientCredentials = clientCredentials
       |
       |  override lazy val engineZIO: ZIO[Any, Nothing, ProcessEngine] =
       |    C7ProcessEngine.withClient(this)(using engineConfig)
       |      .provideLayer(SharedC7ClientManager.layer)
       |
       |  lazy val requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq(
       |    SharedC7ClientManager.layer
       |  )
       |
       |end CompanyEngineC7App
       |""".stripMargin

  private lazy val engineC8Wrapper =
    s"""package $companyName.orchescala.engine
       |
       |/** Camunda 8 settings. */
       |trait CompanyEngineC8Config extends CompanyEngineConfig:
       |
       |  lazy val c8GrpcUrl: String =
       |    sys.env.getOrElse("CAMUNDA_C8_GRPC_URL", "http://localhost:26500")
       |  lazy val c8RestUrl: String =
       |    sys.env.getOrElse("CAMUNDA_C8_REST_URL", "http://localhost:8080")
       |  lazy val c8OperateUrl: String =
       |    sys.env.getOrElse("CAMUNDA_C8_OPERATE_URL", "http://localhost:8080/operate/processes/")
       |
       |end CompanyEngineC8Config
       |
       |object CompanyEngineC8Config extends CompanyEngineC8Config
       |""".stripMargin

  private lazy val engineC8AppWrapper =
    s"""package $companyName.orchescala.engine
       |
       |import orchescala.engine.c8.{C8NoAuthClient, C8ProcessEngine, SharedC8ClientManager}
       |import zio.{ZIO, ZLayer}
       |
       |/** The Camunda 8 engine - without authentication (e.g. a local c8run).
       |  * Camunda SaaS: use C8SaasClient instead of C8NoAuthClient.
       |  */
       |object CompanyEngineC8App extends EngineApp, CompanyEngineC8Config, C8NoAuthClient:
       |
       |  protected def zeebeGrpc: String = c8GrpcUrl
       |  protected def zeebeRest: String = c8RestUrl
       |
       |  override lazy val engineZIO: ZIO[Any, Nothing, ProcessEngine] =
       |    C8ProcessEngine.withClient(this)(using engineConfig)
       |      .provideLayer(SharedC8ClientManager.layer)
       |
       |  lazy val requiredLayers: Seq[ZLayer[Any, Nothing, Any]] = Seq(
       |    SharedC8ClientManager.layer
       |  )
       |
       |end CompanyEngineC8App
       |""".stripMargin

  private def engineGAppWrapper(engines: Seq[EngineType]) =
    s"""package $companyName.orchescala.engine
       |
       |import orchescala.engine.gateway.GProcessEngine
       |import zio.{ZIO, ZLayer}
       |
       |/** All engines behind one ProcessEngine - used by the simulations and as base of the gateway. */
       |trait CompanyEngineGApp extends EngineApp, CompanyEngineConfig:
       |
       |  lazy val requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
       |    ${engines.map(e => s"CompanyEngine${e}App.requiredLayers").mkString(" ++\n       |      ")}
       |
       |  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
       |    for
       |      ${engines.map(e => s"${engineName(e)}Engine <- CompanyEngine${e}App.engineZIO").mkString("\n       |      ")}
       |      // the first engine is the default engine - change the order to change it
       |      given Seq[ProcessEngine] = Seq(${engines.map(e => s"${engineName(e)}Engine").mkString(", ")})
       |    yield GProcessEngine()(using engineConfig)
       |
       |end CompanyEngineGApp
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

  private def simulationWrapper(engines: Seq[EngineType]) =
    val cockpitUrls = engines.map:
      case EngineType.C7 => "EngineType.C7 -> CompanyEngineC7Config.c7CockpitUrl"
      case other         => s"EngineType.$other -> CompanyEngine${other}Config.c8OperateUrl"
    s"""package $companyName.orchescala.simulation
       |
       |import orchescala.engine.domain.EngineType
       |import $companyName.orchescala.engine.*
       |
       |/** Add here company specific stuff, to run the Simulations.
       |  * Runs against all engines (CompanyEngineGApp) - `Company<Engine>Simulation` against one.
       |  */
       |trait CompanySimulation extends SimulationRunner, CompanyEngineGApp:
       |
       |  override def config =
       |    super.config
       |      // login for the worker app (`/worker`), that verifies the tokens (tokenValidation)
       |      .withWorkerAppAuth(clientCredentials)
       |      .withCockpitUrl(
       |        Map(
       |          ${cockpitUrls.mkString(",\n       |          ")}
       |        )
       |      )
       |
       |end CompanySimulation
       |""".stripMargin
  end simulationWrapper

  private lazy val c7SimulationWrapper = engineSimulationWrapper(EngineType.C7)
  private lazy val c8SimulationWrapper = engineSimulationWrapper(EngineType.C8)

  private def engineSimulationWrapper(engine: EngineType) =
    s"""package $companyName.orchescala.simulation
       |
       |import orchescala.engine.ProcessEngine
       |import $companyName.orchescala.engine.CompanyEngine${engine}App
       |import zio.{ZIO, ZLayer}
       |
       |/** Runs the Simulations directly against Camunda ${engine.toString.drop(1)} - CompanySimulation runs them
       |  * against all engines.
       |  */
       |trait Company${engine}Simulation extends CompanySimulation:
       |
       |  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] = CompanyEngine${engine}App.engineZIO
       |
       |  override lazy val requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
       |    CompanyEngine${engine}App.requiredLayers
       |
       |end Company${engine}Simulation
       |""".stripMargin

  private def workerWrapper(engines: Seq[EngineType]) =
    val hasC7 = engines.contains(EngineType.C7)
    val hasC8 = engines.contains(EngineType.C8)
    val imports  = Seq(
      Option.when(hasC7)("import orchescala.worker.c7.{C7Context, C7Worker}"),
      Option.when(hasC8)("import orchescala.worker.c8.{C8Context, C8Worker}")
    ).flatten
    val workers  = Seq(Option.when(hasC7)("C7Worker[In, Out]"), Option.when(hasC8)("C8Worker[In, Out]")).flatten
    val contexts = Seq(
      Option.when(hasC7)(
        "protected def c7Context: C7Context = CompanyEngineContext(CompanyRestApiClient())"
      ),
      Option.when(hasC8)(
        "protected def c8Context: C8Context = CompanyEngineC8Context(CompanyRestApiClient())"
      )
    ).flatten
    s"""package $companyName.orchescala.worker
       |
       |import $companyName.orchescala.engine.CompanyEngineConfig
       |${imports.mkString("\n       |")}
       |
       |import scala.reflect.ClassTag
       |
       |/**
       | * Add here company specific stuff, to run the Workers.
       | * You also define the implementation of the Worker here.
       | */
       |trait CompanyWorker[In <: Product : InOutCodec, Out <: Product : InOutCodec]
       |  extends ${workers.mkString(", ")}:
       |  ${contexts.mkString("\n       |  ")}
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
       |
       |object CompanyWorker extends CompanyEngineConfig:
       |
       |  lazy val companyWorkerConfig: WorkerConfig = DefaultWorkerConfig(
       |    engineConfig = engineConfig,
       |    // verifies the Bearer tokens on `/worker` (forwarded by the gateway, sent by the simulations)
       |    tokenValidation = tokenValidation
       |  )
       |
       |end CompanyWorker
       |""".stripMargin
  end workerWrapper

  private lazy val workerContextWrapper   = workerEngineContextWrapper(EngineType.C7)
  private lazy val workerC8ContextWrapper = workerEngineContextWrapper(EngineType.C8)

  // the Camunda 7 context keeps its former name CompanyEngineContext
  private def workerEngineContextWrapper(engine: EngineType) =
    val className = if engine == EngineType.C7 then "CompanyEngineContext" else s"CompanyEngine${engine}Context"
    s"""package $companyName.orchescala.worker
       |
       |import $companyName.orchescala.engine.CompanyEngine${engine}Config
       |import orchescala.worker.${engineName(engine)}.${engine}Context
       |
       |import scala.reflect.ClassTag
       |
       |class $className(restApiClient: CompanyRestApiClient)
       |    extends ${engine}Context, CompanyEngine${engine}Config:
       |
       |  def workerConfig: WorkerConfig = CompanyWorker.companyWorkerConfig
       |
       |  override def sendRequest[ServiceIn: Encoder, ServiceOut: {Decoder, ClassTag}](
       |      request: RunnableRequest[ServiceIn]
       |  ): SendRequestType[ServiceOut] =
       |    restApiClient.sendRequest(request)
       |
       |end $className
       |""".stripMargin
  end workerEngineContextWrapper

  private lazy val workerRestApiWrapper =
    s"""package $companyName.orchescala.worker
       |
       |/** Sends the requests of the service workers. Override `auth` to authenticate them at your
       |  * services, e.g. with a token of the technical user.
       |  */
       |class CompanyRestApiClient extends RestApiClient
       |""".stripMargin

  private def workerAppWrapper(engines: Seq[EngineType]) =
    val registries = engines.map:
      case EngineType.C7 => "C7WorkerRegistry(CompanyC7Client)"
      case other         => s"${other}WorkerRegistry(Company${other}Client)"
    val context    =
      if engines.contains(EngineType.C7) then "CompanyEngineContext" else "CompanyEngineC8Context"
    s"""package $companyName.orchescala.worker
       |
       |${engines.map(e => s"import orchescala.worker.${engineName(e)}.${e}WorkerRegistry").mkString("\n       |")}
       |
       |trait CompanyWorkerApp extends WorkerApp:
       |
       |  lazy val workerConfig: WorkerConfig = CompanyWorker.companyWorkerConfig
       |
       |  lazy val engineContext: EngineContext = $context(CompanyRestApiClient())
       |
       |  lazy val workerRegistries: Seq[WorkerRegistry] =
       |    Seq(${registries.mkString(", ")})
       |
       |end CompanyWorkerApp
       |""".stripMargin
  end workerAppWrapper

  private lazy val workerCompanyC7ClientWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import $companyName.orchescala.engine.CompanyEngineC7Config
       |import orchescala.engine.rest.OAuthConfig
       |import orchescala.worker.c7.OAuth2PasswordWorkerClient
       |
       |import scala.concurrent.duration.*
       |
       |/** Camunda 7 external task client - authenticates as technical user. */
       |trait CompanyC7Client extends OAuth2PasswordWorkerClient, CompanyEngineC7Config:
       |
       |  lazy val camundaRestUrl: String                 = c7RestUrl
       |  lazy val oAuthConfig: OAuthConfig.PasswordGrant = adminPasswordGrant
       |
       |  override lazy val lockDuration: Duration = 1.minute
       |
       |end CompanyC7Client
       |
       |object CompanyC7Client extends CompanyC7Client
       |""".stripMargin

  private lazy val workerCompanyC8ClientWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import $companyName.orchescala.engine.CompanyEngineC8Config
       |import orchescala.engine.c8.C8NoAuthClient
       |
       |/** Camunda 8 client of the job workers - without authentication (e.g. a local c8run).
       |  * Camunda SaaS: use C8SaasClient instead of C8NoAuthClient.
       |  */
       |trait CompanyC8Client extends C8NoAuthClient, CompanyEngineC8Config:
       |
       |  protected def zeebeGrpc: String = c8GrpcUrl
       |  protected def zeebeRest: String = c8RestUrl
       |
       |end CompanyC8Client
       |
       |object CompanyC8Client extends CompanyC8Client
       |""".stripMargin

  private def gatewayServerWrapper(engines: Seq[EngineType]) =
    val clients = engines.map:
      case EngineType.C7 =>
        """  /** Camunda 7 - the caller's (verified) token is passed through */
          |  lazy val c7Client = C7DefaultBearerTokenClient(c7RestUrl)
          |""".stripMargin
      case other         =>
        """  /** Camunda 8 - the caller's (verified) token is passed through. A cluster without
          |    * authentication (e.g. a local c8run): C8DefaultNoAuthClient(c8GrpcUrl, c8RestUrl)
          |    */
          |  lazy val c8Client = C8DefaultBearerTokenClient(c8GrpcUrl, c8RestUrl)
          |""".stripMargin
    s"""package $companyName.orchescala.gateway
       |
       |import orchescala.engine.ProcessEngine
       |${engines.map(e => s"import orchescala.engine.${engineName(e)}.{${e}DefaultBearerTokenClient, ${e}ProcessEngine, Shared${e}ClientManager}").mkString("\n       |")}
       |import orchescala.engine.gateway.GProcessEngine
       |import $companyName.orchescala.engine.*
       |import $companyName.orchescala.worker.CompanyWorker.companyWorkerConfig
       |import zio.ZIO
       |
       |// sbt gateway/run
       |object GatewayServerApp
       |    extends GatewayServer, CompanyEngineGApp, ${engines.map(e => s"CompanyEngine${e}Config").mkString(", ")}:
       |
       |  override lazy val config: GatewayConfig =
       |    DefaultGatewayConfig(
       |      engineConfig = engineConfig,
       |      workerConfig = companyWorkerConfig,
       |      docsAuth = authCode,
       |      // verifies the Bearer tokens of the callers (CompanyEngineConfig.tokenValidation)
       |      tokenValidation = tokenValidation
       |    )
       |
       |${clients.map(_.linesIterator.mkString("\n       |")).mkString("\n       |\n       |")}
       |
       |  override def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
       |    (for
       |      ${engines.map(e => s"${engineName(e)}Engine <- ${e}ProcessEngine.withClient(${engineName(e)}Client)(using engineConfig)").mkString("\n       |      ")}
       |      // the first engine is the default engine - change the order to change it
       |      given Seq[ProcessEngine] = Seq(${engines.map(e => s"${engineName(e)}Engine").mkString(", ")})
       |    yield GProcessEngine()(using engineConfig))
       |      .provideLayer(${engines.map(e => s"Shared${e}ClientManager.layer").mkString(" ++ ")})
       |
       |  private def authCode =
       |    DocsAuth.OAuth2AuthCode(
       |      ssoBaseUrl = ssoBaseUrl,
       |      realm = ssoRealm,
       |      clientId = ssoClientId,
       |      clientSecret = ssoClientSecret,
       |      scopes = ssoScope
       |    )
       |
       |end GatewayServerApp
       |""".stripMargin
  end gatewayServerWrapper

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
