package orchescala.engine.c7

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.DefaultEngineConfig
import orchescala.engine.domain.*
import zio.test.*
import zio.{IO, ZIO}

object C7DeploymentServiceTest extends ZIOSpecDefault:

  private val config = DefaultEngineConfig()

  private val neverClient: IO[EngineError, ApiClient] =
    ZIO.fail(EngineError.UnexpectedError("ApiClient should not be requested"))

  def spec = suite("C7DeploymentService")(
    test("deploy fails when no deployable resources are provided") {
      val service = C7DeploymentService(using neverClient, config)
      val resources = Seq.empty[DeploymentResource]
      for
        exit <- service.deploy("test", resources, Some(EngineType.C7)).exit
      yield assertTrue(exit.isFailure)
    },
    test("deploy fails when only Form resources are provided") {
      val service = C7DeploymentService(using neverClient, config)
      val resources = Seq(
        DeploymentResource(
          "my-form.form",
          Array.emptyByteArray,
          DeploymentResourceType.Form
        )
      )
      for
        exit <- service.deploy("test", resources, Some(EngineType.C7)).exit
      yield assertTrue(exit.isFailure)
    }
  )
end C7DeploymentServiceTest
