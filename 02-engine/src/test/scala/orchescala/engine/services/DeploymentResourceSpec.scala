package orchescala.engine.services

import orchescala.engine.domain.{DeploymentResource, DeploymentResourceType, EngineError}
import zio.test.*

object DeploymentResourceSpec extends ZIOSpecDefault:

  private def bpmn(name: String) = DeploymentResource(name, Array.emptyByteArray, DeploymentResourceType.Bpmn)

  def spec = suite("Deployment resources")(
    test("the same file name in two folders is refused (400) - one overwrote the other, silently") {
      for exit <- DeploymentResource.uniqueFileNames(Seq(bpmn("a/process.bpmn"), bpmn("b/process.bpmn"), bpmn("c/other.bpmn"))).exit
      yield assertTrue(
        exit.causeOption.flatMap(_.failureOption).exists:
          case EngineError.ServiceRequestError(400, msg) =>
            msg.contains("process.bpmn (a/process.bpmn, b/process.bpmn)") && !msg.contains("other.bpmn")
          case _                                         => false
      )
    },
    test("different file names are fine") {
      for exit <- DeploymentResource.uniqueFileNames(Seq(bpmn("a/process.bpmn"), bpmn("a/other.bpmn"))).exit
      yield assertTrue(exit.isSuccess)
    }
  )
end DeploymentResourceSpec
