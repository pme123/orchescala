package orchescala.helper.dev.company

import orchescala.helper.dev.update.{GenericFileGenerator, createIfNotExists, createOrUpdate, helperDoNotAdjustText}
import orchescala.helper.util.*

case class CompanyWrapperGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    println("Generate Company Wrapper")
    createIfNotExists(config.projectDir / "CHANGELOG.md", GenericFileGenerator().changeLog)
    createIfNotExists(projectDomainPath, domainWrapper)
    createIfNotExists(projectEnginePath, engineWrapper)
    createIfNotExists(projectEngineC8Path, engineC8Wrapper)
    createIfNotExists(projectApiPath, apiWrapper)
    createIfNotExists(projectDmnPath, dmnWrapper)
    createIfNotExists(projectSimulationPath, simulationWrapper)
    createIfNotExists(projectC8SimulationPath, c8SimulationWrapper)
    createIfNotExists(projectC7SimulationPath, c7SimulationWrapper)
    createIfNotExists(projectWorkerPath, workerWrapper)
    createIfNotExists(projectWorkerContextPath, workerContextWrapper)
    createIfNotExists(projectWorkerPasswordPath, workerPasswordWrapper)
    createIfNotExists(projectWorkerRestApiPath, workerRestApiWrapper)
    createIfNotExists(projectWorkerAppPath, workerAppWrapper)
    createIfNotExists(projectWorkerC7ClientPath, workerCompanyC7ClientWrapper)
    createIfNotExists(helperCompanyDevHelperPath, helperCompanyDevHelperWrapper)
    createIfNotExists(helperCompanyDevConfigPath, helperCompanyDevConfigWrapper)
    createIfNotExists(helperCompanyOrchescalaDevHelperPath, helperCompanyOrchescalaDevHelperWrapper)
    createOrUpdate(helperCompanyOpenApiHtmlPath, helperCompanyOpenApiHtml)
  end generate

  private lazy val companyName = config.companyName
  private lazy val companyNameNice = config.companyName.head.toUpper + config.companyName.tail

  private lazy val projectDomainPath = ModuleConfig.domainModule.srcPath / "CompanyBpmnDsl.scala"
  private lazy val projectEnginePath = ModuleConfig.engineModule.srcPath / "CompanyEngineConfig.scala"
  private lazy val projectEngineC8Path = ModuleConfig.engineModule.srcPath / "CompanyEngineC8Config.scala"
  private lazy val projectApiPath = ModuleConfig.apiModule.srcPath / "CompanyApiCreator.scala"
  private lazy val projectDmnPath = ModuleConfig.dmnModule.srcPath / "CompanyDmnTester.scala"
  private lazy val projectSimulationPath = ModuleConfig.simulationModule.srcPath / "CompanySimulation.scala"
  private lazy val projectC8SimulationPath = ModuleConfig.simulationModule.srcPath / "CompanyC8Simulation.scala"
  private lazy val projectC7SimulationPath = ModuleConfig.simulationModule.srcPath / "CompanyC7Simulation.scala"
  private lazy val projectWorkerPath = ModuleConfig.workerModule.srcPath / "CompanyWorker.scala"
  private lazy val projectWorkerContextPath = ModuleConfig.workerModule.srcPath / "CompanyEngineContext.scala"
  private lazy val projectWorkerPasswordPath = ModuleConfig.workerModule.srcPath / "CompanyPasswordFlow.scala"
  private lazy val projectWorkerRestApiPath = ModuleConfig.workerModule.srcPath / "CompanyRestApiClient.scala"
  private lazy val projectWorkerAppPath = ModuleConfig.workerModule.srcPath / "CompanyWorkerApp.scala"
  private lazy val projectWorkerC7ClientPath = ModuleConfig.workerModule.srcPath / "CompanyC7Client.scala"
  private lazy val helperCompanyDevHelperPath = ModuleConfig.helperModule.srcPath / "CompanyDevHelper.scala"
  private lazy val helperCompanyDevConfigPath = ModuleConfig.helperModule.srcPath / "CompanyDevConfig.scala"
  private lazy val helperCompanyOrchescalaDevHelperPath = ModuleConfig.helperModule.srcPath / "CompanyOrchescalaDevHelper.scala"
  private lazy val helperCompanyOpenApiHtmlPath = ModuleConfig.helperModule.resourcePath / "CompanyOpenApi.html"

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

  private lazy val engineWrapper =
    s"""package $companyName.orchescala
       |package engine
       |
       |/**
       | * Add here company specific stuff, to configure the Engine.
       | */
       |object CompanyEngineConfig:
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
       |end CompanyEngineConfig
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
       |trait CompanyDmnTester extends DmnTesterConfigCreator:
       |
       |  override def starterConfig: DmnTesterStarterConfig =
       |    DmnTesterStarterConfig(companyName = "$companyName")
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
       |trait CompanyC7Simulation extends SimulationRunner, CompanyEngineConfig, C7LocalClient:
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
       |import $companyName.orchescala.engine.CompanyEngineConfig
       |
       |trait CompanyPasswordFlow extends OAuth2WorkerClient:
       |
       |  def ssoRealm: String = CompanyEngineConfig.ssoRealm
       |  def ssoBaseUrl: String = CompanyEngineConfig.ssoBaseUrl
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
       |import democompany.orchescala.engine.CompanyEngineConfig
       |import orchescala.worker.c7.OAuth2WorkerClient
       |import scala.concurrent.duration.*
       |
       |trait CompanyC7Client extends OAuth2WorkerClient:
       |  lazy val ssoRealm = CompanyEngineConfig.ssoRealm
       |  lazy val ssoBaseUrl = CompanyEngineConfig.ssoBaseUrl
       |  override lazy val camundaRestUrl = CompanyEngineConfig.camundaRestUrl
       |  override lazy val client_id = CompanyEngineConfig.ssoClientName
       |  override lazy val client_secret = CompanyEngineConfig.ssoClientSecret
       |  override lazy val scope = CompanyEngineConfig.ssoScope
       |  override lazy val username = CompanyEngineConfig.ssoTechuserName
       |  override lazy val password = CompanyEngineConfig.ssoTechuserPassword
       |
       |  override lazy val lockDuration: Long = 5.minutes.toMillis
       |
       |end CompanyC7Client
       |
       |object CompanyC7Client extends CompanyC7Client
       |""".stripMargin

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
  
  private lazy val helperCompanyDevConfigWrapper =
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

  private lazy val helperCompanyOpenApiHtml =
    s"""|<!-- $helperDoNotAdjustText -->
        |<!DOCTYPE html>
        |<html>
        |<head>
        |    <title>$companyNameNice Documentation Home</title>
        |
        |    <!-- needed for adaptive design -->
        |    <meta charset="utf-8"/>
        |    <meta name="viewport" content="width=device-width, initial-scale=1">
        |    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
        |
        |    <!-- bpmn styles -->
        |    <link rel="stylesheet" href="https://unpkg.com/bpmn-js@11.5.0/dist/assets/bpmn-js.css">
        |    <!-- dmn styles -->
        |    <link rel="stylesheet" href="https://unpkg.com/dmn-js@14.1.0/dist/assets/dmn-js-shared.css">
        |    <link rel="stylesheet" href="https://unpkg.com/dmn-js@14.1.0/dist/assets/dmn-js-drd.css">
        |    <link rel="stylesheet" href="https://unpkg.com/dmn-js@14.1.0/dist/assets/dmn-js-decision-table.css">
        |    <link rel="stylesheet" href="https://unpkg.com/dmn-js@14.1.0/dist/assets/dmn-js-literal-expression.css">
        |    <link rel="stylesheet" href="https://unpkg.com/dmn-js@14.1.0/dist/assets/dmn-font/css/dmn.css">
        |
        |    <!--
        |    ReDoc doesn't change outer page styles
        |    -->
        |    <style>
        |        body {
        |            margin: 0;
        |            padding: 0;
        |            z-index: 10;
        |
        |        }
        |        header {
        |            background-color:  #ebf6f7;
        |            border-bottom: 1px solid #a7d4de;
        |            z-index: 12;
        |        }
        |        .homeLink {
        |            text-decoration: none;
        |            margin: 0;
        |            padding-top: 8px;
        |            padding-bottom: 0px;
        |            padding-left: 16px;
        |            width: 100%;
        |            text-align: center;
        |
        |        }
        |        /* The sticky class is added to the header with JS when it reaches its scroll position */
        |        .sticky {
        |            position: fixed;
        |            top: 0;
        |            width: 100%
        |        }
        |        .sticky + .content {
        |            padding-top: 102px;
        |        }
        |        .diagramCanvas {
        |            border: solid 1px grey;
        |            height:500px;
        |        }
        |        .diagram {
        |            padding: 5px;
        |            height: 100%;
        |        }
        |    </style>
        |    <script>
        |        function downloadSVG(id) {
        |            const container = document.getElementById(id);
        |            const svg = container.getElementsByTagName('svg')[1];
        |            console.log(svg)
        |            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        |            const blob = new Blob([svg.outerHTML.toString()]);
        |            const element = document.createElement("a");
        |            element.download = id +".svg";
        |            element.href = window.URL.createObjectURL(blob);
        |            element.click();
        |            element.remove();
        |        }
        |    </script>
        |</head>
        |<body>
        |<header id="myHeader">
        |    <p class="homeLink">
        |        <a href="../index.html">
        |            <svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="24px" height="24px"
        |                 viewBox="0 0 391.08 391.08">
        |                <title>$companyNameNice Documentation Home</title>
        |                <defs>
        |                    <style>.cls-1 {
        |                        fill: #007c99;
        |                        stroke: #007c99;
        |                        stroke-miterlimit: 10;
        |                        stroke-width: 3px;
        |                    }
        |
        |                    .cls-2 {
        |                        fill: #007c99;
        |                    }</style>
        |                </defs>
        |                <title>Icon_home_remixofdynamitt</title>
        |                <g id="layer1">
        |                    <path id="rect2391" class="cls-2"
        |                          d="M326.67,203.55L200.38,91.71,74,203.6V363.47a7.44,7.44,0,0,0,7.46,7.45h79v-70.1a7.44,7.44,0,0,1,7.45-7.46h64.88a7.44,7.44,0,0,1,7.45,7.46v70.1h79a7.42,7.42,0,0,0,7.45-7.45V203.55Z"
        |                          transform="translate(-4.8 -5.17)"/>
        |                    <path id="path2399" class="cls-2"
        |                          d="M199.65,30.51L20.44,189.19l18.88,21.29L200.38,67.86l161,142.62,18.84-21.29L201.08,30.51l-0.7.81-0.73-.81h0Z"
        |                          transform="translate(-4.8 -5.17)"/>
        |                    <path id="rect2404" class="cls-2" d="M74,53.35h45.43l-0.4,26.91L74,120.94V53.35h0Z"
        |                          transform="translate(-4.8 -5.17)"/>
        |                </g>
        |            </svg>
        |        </a>
        |    </p>
        |</header>
        |
        |<script>
        |    // When the user scrolls the page, execute myFunction
        |    window.onscroll = function() {myFunction()};
        |
        |    // Get the header
        |    var header = document.getElementById("myHeader");
        |
        |    // Get the offset position of the navbar
        |    var sticky = header.offsetTop;
        |
        |    // Add the sticky class to the header when you reach its scroll position. Remove "sticky" when you leave the scroll position
        |    function myFunction() {
        |        if (window.scrollY > sticky) {
        |            header.classList.add("sticky");
        |        } else {
        |            header.classList.remove("sticky");
        |        }
        |    }
        |</script>
        |<!-- bpmn viewer -->
        |<script src="https://unpkg.com/bpmn-js@11.5.0/dist/bpmn-viewer.development.js"></script>
        |<!-- dmn viewer -->
        |<script src="https://unpkg.com/dmn-js@14.1.0/dist/dmn-viewer.development.js"></script>
        |<!-- jquery (required for bpmn / dmn example) -->
        |<script src="https://unpkg.com/jquery@3.3.1/dist/jquery.js"></script>
        |<script>
        |
        |    function openFromUrl(url, viewer) {
        |        console.log('attempting to open <' + url + '>');
        |        $$.ajax("diagrams/" + url, {dataType: 'text'}).done(async function (xml) {
        |
        |            try {
        |                await viewer.importXML(xml);
        |                if(url.endsWith(".bpmn"))
        |                    viewer.get('canvas').zoom('fit-viewport');
        |                else {
        |                    const activeEditor = viewer.getActiveViewer();
        |                    activeEditor.get('canvas').zoom('fit-viewport');
        |                }
        |            } catch (err) {
        |                console.error(err);
        |            }
        |        });
        |    }
        |</script>
        |<redoc class="content" spec-url='./OpenApi.yml'></redoc>
        |<script src="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js"></script>
        |</body>
        |</html>
        |""".stripMargin

  extension (module: ModuleConfig)
    def srcPath: os.Path =
      config.projectDir / module.packagePath(
        config.projectPath
      )
    def resourcePath: os.Path =
      config.projectDir / module.packagePath(
        config.projectPath,
        isSourceDir = false
      )
end CompanyWrapperGenerator
