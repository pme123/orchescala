package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.DeploymentService
import zio.ZIO.{logDebug, logWarning}
import zio.{IO, ZIO}

import java.time.Instant
import scala.jdk.CollectionConverters.*

class C8DeploymentService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends DeploymentService,
      C8Service:

  override def deploy(
      name: String,
      resources: Seq[DeploymentResource],
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, DeploymentResult] =
    val deployableResources = resources.filter: resource =>
      resource.resourceType != DeploymentResourceType.Form &&
        resource.resourceType != DeploymentResourceType.Script

    for
      _             <- validateTargetEngine(targetEngine)
      _             <- logDebug(s"Deploying '$name' to C8 with ${resources.size} resources")
      _             <- ZIO
                          .when(resources.exists(_.resourceType == DeploymentResourceType.Form)):
                            logWarning(
                              "Form resources are ignored for C8 deployments in the current implementation"
                            )
      _             <- ZIO
                          .when(resources.exists(_.resourceType == DeploymentResourceType.Script)):
                            ZIO.fail(
                              EngineError.ProcessError(
                                "Script resources are not supported for C8 deployments"
                              )
                            )
      camundaClient <- camundaClientZIO
      result        <-
        if deployableResources.isEmpty then
          ZIO.succeed(
            DeploymentResult(
              deploymentId = "0",
              name = name,
              deploymentTime = Instant.now(),
              deployedProcesses = Seq.empty,
              deployedDecisions = Seq.empty,
              deployedForms = Seq.empty,
              deployedScripts = Seq.empty
            )
          )
        else
          ZIO
            .attempt:
              val builder = camundaClient
                .newDeployResourceCommand()

              val first             = deployableResources.head
              val withFirstResource = builder
                .addResourceBytes(first.content, first.name)
              val withTenant = engineConfig.tenantId match
                case Some(tenantId) => withFirstResource.tenantId(tenantId)
                case None           => withFirstResource
              val finalBuilder = deployableResources.tail.foldLeft(withTenant):
                (acc, resource) =>
                  acc.addResourceBytes(resource.content, resource.name)

              mapDeploymentResult(name, finalBuilder.send().join())
            .mapError: err =>
              EngineError.ProcessError(
                s"Problem deploying '$name' to C8: $err"
              )
    yield result
  end deploy

  override def getDeployments(
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentInfo]] =
    validateTargetEngine(targetEngine) *>
      ZIO.fail(
        EngineError.UnexpectedError(
          "getDeployments is not supported by the C8 Java client in this version"
        )
      )

  override def deleteDeployment(
      deploymentId: String,
      cascade: Boolean = false,
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Unit] =
    validateTargetEngine(targetEngine) *>
      ZIO.fail(
        EngineError.UnexpectedError(
          "deleteDeployment is not supported by the C8 Java client in this version"
        )
      )

  private def validateTargetEngine(targetEngine: Option[EngineType]): IO[EngineError, Unit] =
    targetEngine match
      case Some(engineType) if engineType != EngineType.C8 =>
        ZIO.fail(
          EngineError.UnexpectedError(
            s"C8DeploymentService only supports EngineType.C8, got $engineType"
          )
        )
      case _ => ZIO.unit

  private def mapDeploymentResult(
      name: String,
      event: io.camunda.client.api.response.DeploymentEvent
  ): DeploymentResult =
    DeploymentResult(
      deploymentId = event.getKey.toString,
      name = name,
      deploymentTime = Instant.now(),
      deployedProcesses = event.getProcesses.asScala.toSeq.map: p =>
        ProcessDefinitionInfo(
          id = p.getProcessDefinitionKey.toString,
          key = p.getBpmnProcessId,
          version = p.getVersion
        ),
      deployedDecisions = event.getDecisions.asScala.toSeq.map: d =>
        DecisionDefinitionInfo(
          id = d.getDecisionKey.toString,
          key = d.getDmnDecisionId,
          version = d.getVersion
        ),
      deployedForms = event.getForm.asScala.toSeq.map: f =>
        FormInfo(
          id = f.getFormKey.toString,
          key = f.getFormId,
          version = f.getVersion
        ),
      deployedScripts = Seq.empty
    )

end C8DeploymentService
