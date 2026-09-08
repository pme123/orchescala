package orchescala.engine.gateway

import orchescala.engine.domain.*
import orchescala.engine.services.DeploymentService
import zio.test.*
import zio.{IO, ZIO}

import java.time.Instant

object GDeploymentServiceTest extends ZIOSpecDefault:

  case class MockDeploymentService(
      engineTypeValue: EngineType,
      shouldFail: Boolean
  ) extends DeploymentService:
    val engineType: EngineType = engineTypeValue
    var deployCalls: List[(String, Seq[DeploymentResource], Option[EngineType])] = Nil
    var manifestCalls: List[(DeploymentManifest, Option[EngineType])]            = Nil
    var getCalls: List[Option[EngineType]]                                    = Nil
    var deleteCalls: List[(String, Boolean, Option[EngineType])]              = Nil

    override def deploy(
        name: String,
        resources: Seq[DeploymentResource],
        targetEngine: Option[EngineType]
    ): IO[EngineError, DeploymentResult] =
      deployCalls = (name, resources, targetEngine) :: deployCalls
      if shouldFail then
        ZIO.fail(EngineError.ProcessError(s"$engineType deploy failed"))
      else ZIO.succeed(deploymentResult(name))

    override def getDeployments(
        targetEngine: Option[EngineType]
    ): IO[EngineError, Seq[DeploymentInfo]] =
      getCalls = targetEngine :: getCalls
      if shouldFail then
        ZIO.fail(EngineError.ProcessError(s"$engineType getDeployments failed"))
      else ZIO.succeed(Seq(deploymentInfo(s"$engineType-deployment")))

    override def deleteDeployment(
        deploymentId: String,
        cascade: Boolean,
        targetEngine: Option[EngineType]
    ): IO[EngineError, Unit] =
      deleteCalls = (deploymentId, cascade, targetEngine) :: deleteCalls
      if shouldFail then ZIO.fail(EngineError.ProcessError(s"$engineType delete failed"))
      else ZIO.unit

    override def deployManifest(
        manifest: DeploymentManifest,
        targetEngine: Option[EngineType]
    ): IO[EngineError, Seq[DeploymentResult]] =
      manifestCalls = (manifest, targetEngine) :: manifestCalls
      if shouldFail then
        ZIO.fail(EngineError.ProcessError(s"$engineType deployManifest failed"))
      else ZIO.succeed(Seq(deploymentResult(s"$engineType-manifest")))
  end MockDeploymentService

  private def deploymentResult(name: String): DeploymentResult =
    DeploymentResult(
      deploymentId = "test-id",
      name = name,
      deploymentTime = Instant.EPOCH,
      deployedProcesses = Seq.empty,
      deployedDecisions = Seq.empty,
      deployedForms = Seq.empty,
      deployedScripts = Seq.empty
    )

  private def deploymentInfo(name: String): DeploymentInfo =
    DeploymentInfo(
      id = "test-id",
      name = name,
      deploymentTime = Some(Instant.EPOCH)
    )

  def spec = suite("GDeploymentService")(
    test("deploy routes to the requested engine") {
      val c7Service = MockDeploymentService(EngineType.C7, shouldFail = false)
      val c8Service = MockDeploymentService(EngineType.C8, shouldFail = false)
      val gService  = GDeploymentService(using Seq(c7Service, c8Service))
      for
        result <- gService.deploy("myDeploy", Seq.empty, Some(EngineType.C8))
      yield assertTrue(
        result.name == "myDeploy",
        c7Service.deployCalls.isEmpty,
        c8Service.deployCalls.length == 1,
        c8Service.deployCalls.head._3.contains(EngineType.C8)
      )
    },
    test("deploy falls back to the next service when no targetEngine is given") {
      val c7Service = MockDeploymentService(EngineType.C7, shouldFail = true)
      val c8Service = MockDeploymentService(EngineType.C8, shouldFail = false)
      val gService  = GDeploymentService(using Seq(c7Service, c8Service))
      for
        result <- gService.deploy("myDeploy", Seq.empty, None)
      yield assertTrue(
        result.name == "myDeploy",
        c7Service.deployCalls.length == 1,
        c8Service.deployCalls.length == 1
      )
    },
    test("deploy fails when all services fail and no targetEngine is given") {
      val c7Service = MockDeploymentService(EngineType.C7, shouldFail = true)
      val c8Service = MockDeploymentService(EngineType.C8, shouldFail = true)
      val gService  = GDeploymentService(using Seq(c7Service, c8Service))
      for
        exit <- gService.deploy("myDeploy", Seq.empty, None).exit
      yield assertTrue(exit.isFailure)
    },
    test("deployManifest routes to the requested engine") {
      val c7Service = MockDeploymentService(EngineType.C7, shouldFail = false)
      val c8Service = MockDeploymentService(EngineType.C8, shouldFail = false)
      val gService  = GDeploymentService(using Seq(c7Service, c8Service))
      val manifest  = DeploymentManifest(Seq(DeploymentEntry("mycompany", "myproject", "1.2.0")))
      for
        results <- gService.deployManifest(manifest, Some(EngineType.C8))
      yield assertTrue(
        results.size == 1,
        c7Service.manifestCalls.isEmpty,
        c8Service.manifestCalls.length == 1,
        c8Service.manifestCalls.head._2.contains(EngineType.C8)
      )
    },
    test("deployManifest falls back when no targetEngine is given") {
      val c7Service = MockDeploymentService(EngineType.C7, shouldFail = true)
      val c8Service = MockDeploymentService(EngineType.C8, shouldFail = false)
      val gService  = GDeploymentService(using Seq(c7Service, c8Service))
      val manifest  = DeploymentManifest(Seq(DeploymentEntry("mycompany", "myproject", "1.2.0")))
      for
        results <- gService.deployManifest(manifest, None)
      yield assertTrue(
        results.size == 1,
        c7Service.manifestCalls.length == 1,
        c8Service.manifestCalls.length == 1
      )
    },
    test("getDeployments routes to the requested engine") {
      val c7Service = MockDeploymentService(EngineType.C7, shouldFail = false)
      val c8Service = MockDeploymentService(EngineType.C8, shouldFail = false)
      val gService  = GDeploymentService(using Seq(c7Service, c8Service))
      for
        result <- gService.getDeployments(Some(EngineType.C7))
      yield assertTrue(
        result.head.name == "C7-deployment",
        c7Service.getCalls.length == 1,
        c8Service.getCalls.isEmpty
      )
    },
    test("deleteDeployment routes to the requested engine") {
      val c7Service = MockDeploymentService(EngineType.C7, shouldFail = false)
      val c8Service = MockDeploymentService(EngineType.C8, shouldFail = false)
      val gService  = GDeploymentService(using Seq(c7Service, c8Service))
      for
        _ <- gService.deleteDeployment("dep-1", cascade = true, Some(EngineType.C8))
      yield assertTrue(
        c7Service.deleteCalls.isEmpty,
        c8Service.deleteCalls.length == 1,
        c8Service.deleteCalls.head == (("dep-1", true, Some(EngineType.C8)))
      )
    }
  )
end GDeploymentServiceTest
