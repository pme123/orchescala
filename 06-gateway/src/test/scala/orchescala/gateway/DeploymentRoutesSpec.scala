package orchescala.gateway

import orchescala.engine.DefaultEngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.DeploymentService
import orchescala.worker.DefaultWorkerConfig
import sttp.tapir.server.ziohttp.ZioHttpInterpreter
import zio.*
import zio.http.*
import zio.test.*

import java.time.Instant

object DeploymentRoutesSpec extends ZIOSpecDefault:

  private object StubDeploymentService extends DeploymentService:
    val engineType: EngineType = EngineType.C7

    def deploy(name: String, resources: Seq[DeploymentResource], targetEngine: Option[EngineType])
        : IO[EngineError, DeploymentResult] = ZIO.fail(EngineError.ProcessError("not used"))

    def getDeployments(targetEngine: Option[EngineType]): IO[EngineError, Seq[DeploymentInfo]] =
      ZIO.succeed(Seq(DeploymentInfo("1", "dep", None, Some(EngineType.C7))))

    def deleteDeployment(id: String, cascade: Boolean, targetEngine: Option[EngineType])
        : IO[EngineError, Unit] = ZIO.unit

    override def postDeployments(manifest: DeploymentManifest, targetEngine: Option[EngineType])
        : IO[EngineError, Seq[DeploymentResult]] =
      ZIO.succeed(Seq(DeploymentResult(
        deploymentId = "dep-1",
        name = manifest.deployments.head.project,
        engineType = EngineType.C7,
        deploymentTime = Instant.EPOCH,
        deployedProcesses = Seq.empty,
        deployedDecisions = Seq.empty,
        deployedForms = Seq.empty,
        deployedScripts = Seq.empty
      )))
  end StubDeploymentService

  private given GatewayConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
  )

  private lazy val routes =
    ZioHttpInterpreter().toHttp(DeploymentRoutes(StubDeploymentService).routes)

  private val manifest =
    """{"deployments":[{"company":"mycompany","project":"mycompany-myproject","version":"1.2.0"}]}"""

  private def post(path: String, body: String = manifest) =
    Request
      .post(URL.decode(path).toOption.get, Body.fromString(body))
      .addHeader(Header.Authorization.Bearer("token"))
      .addHeader(Header.ContentType(MediaType.application.json))

  def spec = suite("DeploymentRoutes")(
    test("POST /deployment deploys the manifest") {
      for
        response <- routes.runZIO(post("/deployment"))
        body     <- response.body.asString
      yield assertTrue(response.status == Status.Ok, body.contains("mycompany-myproject"))
    },
    test("an invalid targetEngine is a bad request (400) - not 500") {
      for response <- routes.runZIO(post("/deployment?targetEngine=C9"))
      yield assertTrue(response.status == Status.BadRequest)
    },
    test("an invalid manifest is a bad request (400) - not 500") {
      for response <- routes.runZIO(post("/deployment", """{"deploys":[]}"""))
      yield assertTrue(response.status == Status.BadRequest)
    }
  )
end DeploymentRoutesSpec
