package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.{ClasspathManifestResolver, DeploymentService, ManifestResolver, RepositoryManifestResolver}
import zio.ZIO.{logDebug, logWarning}
import zio.{IO, ZIO}

import java.nio.file.Paths
import java.time.Instant
import scala.jdk.CollectionConverters.*

class C8DeploymentService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends DeploymentService,
      C8Service:

  override protected lazy val manifestResolver: ManifestResolver =
    ManifestResolver.firstNonEmpty:
      Seq(
        RepositoryManifestResolver(
          "camunda8",
          fallbackToRoot = true,
          repositories = engineConfig.deploymentRepositories
        ),
        ClasspathManifestResolver("camunda8", fallbackToRoot = true)
      )

  override def deploy(
      name: String,
      resources: Seq[DeploymentResource],
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, DeploymentResult] =
    val deployableResources = resources.filter: resource =>
      resource.resourceType != DeploymentResourceType.Script

    for
      _             <- validateTargetEngine(targetEngine)
      _             <- logDebug(s"Deploying '$name' to C8 with ${resources.size} resources")
      _             <- logDebug(
                           s"C8 deployment resources: ${deployableResources.map(_.name).mkString(", ")}"
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
          ZIO.fail(
            EngineError.ProcessError(
              s"No deployable resources found for deployment '$name'"
            )
          )
        else
          ZIO
            .attemptBlocking:
              val builder = camundaClient
                .newDeployResourceCommand()

              val firstResource = deployableResources.head
              val withFirstResource = builder.addResourceBytes(
                firstResource.content,
                Paths.get(firstResource.name).getFileName.toString
              )
              val withResources = deployableResources.tail.foldLeft(withFirstResource):
                (acc, resource) =>
                  acc.addResourceBytes(resource.content, Paths.get(resource.name).getFileName.toString)
              val finalBuilder = engineConfig.tenantId match
                case Some(tenantId) => withResources.tenantId(tenantId)
                case None           => withResources

              val result = mapDeploymentResult(name, EngineType.C8, finalBuilder.send().join())
              if result.deployedProcesses.isEmpty && result.deployedDecisions.isEmpty && result.deployedForms.isEmpty then
                throw RuntimeException(
                  s"C8 accepted deployment '$name' but returned no deployed process, decision or form definitions"
                )
              result
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
      engineType: EngineType,
      event: io.camunda.client.api.response.DeploymentEvent
  ): DeploymentResult =
    DeploymentResult(
      deploymentId = event.getKey.toString,
      name = name,
      engineType = engineType,
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
