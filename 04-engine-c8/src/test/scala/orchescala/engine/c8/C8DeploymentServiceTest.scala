package orchescala.engine.c8

import orchescala.engine.DefaultEngineConfig
import orchescala.engine.domain.*
import zio.test.*
import zio.ZIO

object C8DeploymentServiceTest extends ZIOSpecDefault:

  private val config = DefaultEngineConfig()

  // This client must never be called by the tests below; the guarded paths fail earlier.
  private val neverClient: C8RestClient =
    C8RestClient("http://never-called.invalid", C8RestAuth.NoAuth)

  def spec = suite("C8DeploymentService")(
    test("deploy rejects deployments that contain Script resources") {
      val service = C8DeploymentService(using neverClient, config)
      val resources = Seq(
        DeploymentResource(
          "my-script.js",
          Array.emptyByteArray,
          DeploymentResourceType.Script
        )
      )
      for
        exit <- service.deploy("test", resources, Some(EngineType.C8)).exit
      yield assertTrue(exit.isFailure)
    },
    test("deploy rejects Script resources even when mixed with supported resources") {
      val service = C8DeploymentService(using neverClient, config)
      val resources = Seq(
        DeploymentResource(
          "process.bpmn",
          Array.emptyByteArray,
          DeploymentResourceType.Bpmn
        ),
        DeploymentResource(
          "script.js",
          Array.emptyByteArray,
          DeploymentResourceType.Script
        )
      )
      for
        exit <- service.deploy("test", resources, Some(EngineType.C8)).exit
      yield assertTrue(exit.isFailure)
    },
    test("deploy fails when no deployable resources are provided") {
      val service   = C8DeploymentService(using neverClient, config)
      val resources = Seq.empty[DeploymentResource]
      for
        exit <- service.deploy("test", resources, Some(EngineType.C8)).exit
      yield assertTrue(exit.isFailure)
    }
  )
end C8DeploymentServiceTest
