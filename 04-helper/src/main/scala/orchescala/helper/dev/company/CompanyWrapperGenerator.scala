package orchescala.helper.dev.company

import orchescala.helper.dev.update.createIfNotExists
import orchescala.helper.util.*

case class CompanyWrapperGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    createIfNotExists(projectDomainPath, domainWrapper)
    createIfNotExists(projectApiPath, apiWrapper)
    createIfNotExists(projectDmnPath, dmnWrapper)
    createIfNotExists(projectSimulationPath, simulationWrapper)
    os.makeDir.all(projectWorkerOrchescalaPath)
    createIfNotExists(projectWorkerPath, workerWrapper)
    createIfNotExists(projectWorkerContextPath, workerContextWrapper)
    createIfNotExists(projectWorkerPasswordPath, workerPasswordWrapper)
    createIfNotExists(projectWorkerRestApiPath, workerRestApiWrapper)
    createIfNotExists(helperCompanyDevHelperPath, helperCompanyDevHelperWrapper)
    createIfNotExists(helperCompanyDevConfigPath, helperCompanyDevConfigWrapper)
    createIfNotExists(helperCompanyOrchescalaDevHelperPath, helperCompanyOrchescalaDevHelperWrapper)

  private lazy val companyName = config.companyName

  private lazy val projectDomainPath = ModuleConfig.domainModule.srcPath / "CompanyBpmnDsl.scala"
  private lazy val projectApiPath = ModuleConfig.apiModule.srcPath / "CompanyApiCreator.scala"
  private lazy val projectDmnPath = ModuleConfig.dmnModule.srcPath / "CompanyDmnTester.scala"
  private lazy val projectSimulationPath = ModuleConfig.simulationModule.srcPath / "CompanySimulation.scala"
  private lazy val projectWorkerOrchescalaPath = os.Path(ModuleConfig.workerModule.srcPath.toString.replace(s"/$companyName", ""))
  private lazy val projectWorkerPath = projectWorkerOrchescalaPath / "CompanyWorker.scala"
  private lazy val projectWorkerContextPath = ModuleConfig.workerModule.srcPath / "CompanyEngineContext.scala"
  private lazy val projectWorkerPasswordPath = ModuleConfig.workerModule.srcPath / "CompanyPasswordFlow.scala"
  private lazy val projectWorkerRestApiPath = ModuleConfig.workerModule.srcPath / "CompanyRestApiClient.scala"
  private lazy val helperCompanyDevHelperPath = ModuleConfig.helperModule.srcPath / "CompanyDevHelper.scala"
  private lazy val helperCompanyDevConfigPath = ModuleConfig.helperModule.srcPath / "CompanyDevConfig.scala"
  private lazy val helperCompanyOrchescalaDevHelperPath = ModuleConfig.helperModule.srcPath / "CompanyOrchescalaDevHelper.scala"

  private lazy val domainWrapper =
    s"""package $companyName.orchescala.domain
       |
       |/**
       | * Add here company specific stuff, like documentation or custom elements.
       | */
       |trait CompanyBpmnDsl:
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

  private lazy val apiWrapper =
    s"""package $companyName.orchescala
       |package api
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
       |   lazy val apiConfig = ApiConfig(companyName = "$companyName")
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
       |import orchescala.simulation.custom.*
       |
       |/**
       | * Add here company specific stuff, to run the Simulations.
       | */
       |trait CompanySimulation extends BasicSimulationDsl:
       |
       |  override def config =
       |    super.config //TODO Adjust config if needed
       |
       |end CompanySimulation
       |""".stripMargin

  private lazy val workerWrapper =
    s"""package $companyName.orchescala.worker
       |
       |import orchescala.worker.c7.{C7Context, C7Worker}
       |import orchescala.worker.c8.{C8Context, C8Worker}
       |import $companyName.orchescala.worker.*
       |
       |import scala.reflect.ClassTag
       |
       |/**
       | * Add here company specific stuff, to run the Workers.
       | * You also define the implementation of the Worker here.
       | */
       |trait CompanyWorker[In <: Product : InOutCodec, Out <: Product : InOutCodec]
       |  extends C7Worker[In, Out], C8Worker[In, Out]
       |  protected def c7Context: C7Context = CompanyEngineContext(CompanyRestApiClient())
       |  protected def c8Context: C8Context = CompanyEngineContext(CompanyRestApiClient())
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
       |import scala.compiletime.uninitialized
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
       |
       |trait CompanyPasswordFlow extends OAuth2WorkerClient:
       |
       |  def fssoRealm: String = ???
       |  def fssoBaseUrl: String = ???
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
         |      tempGitDir = os.pwd / os.up / "git-temp"
         |    )
         |
         |  lazy val devConfig: DevConfig = CompanyDevConfig.companyConfig
         |
         |end CompanyOrchescalaDevHelper
         |""".stripMargin
  end helperCompanyOrchescalaDevHelperWrapper

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
