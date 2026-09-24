package orchescala.engine.c8

import io.circe.Json
import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.{DeploymentService, ManifestResolver, RepositoryManifestResolver}
import zio.ZIO.{logDebug, logWarning}
import sttp.client3.{multipart, RequestBody}
import sttp.model.{MediaType, Part}
import zio.{IO, ZIO}

import java.nio.file.Paths
import java.time.Instant

class C8DeploymentService(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends DeploymentService,
      C8Service:

  override protected lazy val manifestResolver: ManifestResolver =
    RepositoryManifestResolver(
      "camunda8",
      fallbackToRoot = true,
      repositories = engineConfig.deploymentRepositories
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
      result        <-
        if deployableResources.isEmpty then
          ZIO.fail(
            EngineError.ProcessError(
              s"No deployable resources found for deployment '$name'"
            )
          )
        else
          val resourceParts: Seq[Part[RequestBody[Any]]] =
            deployableResources.map: resource =>
              multipart("resources", resource.content)
                .fileName(Paths.get(resource.name).getFileName.toString)
                .contentType(MediaType.ApplicationOctetStream)
          val tenantPart: Seq[Part[RequestBody[Any]]]    =
            engineConfig.tenantId.toSeq.map(multipart("tenantId", _))
          rest
            .postMultipart[C8RestModel.DeploymentResult](
              Seq("deployments"),
              resourceParts ++ tenantPart,
              C8RestClient.deployTimeout
            )
            .mapError(withContext(s"Problem deploying '$name' to C8"))
            .map(mapDeploymentResult(name, EngineType.C8, _))
            .filterOrFail(result =>
              result.deployedProcesses.nonEmpty || result.deployedDecisions.nonEmpty ||
                result.deployedForms.nonEmpty
            )(EngineError.ProcessError(
              s"C8 accepted deployment '$name' but returned no deployed process, decision or form definitions"
            ))
    yield result
  end deploy

  /** Zeebe has no deployment entity to list - the closest "deploy status" is the set of
    * deployed process definitions, one `DeploymentInfo` each (key, bpmn process id, version).
    */
  override def getDeployments(
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentInfo]] =
    for
      _           <- validateTargetEngine(targetEngine)
      definitions <- rest
                       .searchAll[C8RestModel.ProcessDefinitionResult](
                         Seq("process-definitions", "search"),
                         filter = Json.obj()
                       )
                       .mapError(withContext("Problem getting process definitions from C8"))
    yield definitions.map: d =>
      DeploymentInfo(
        id = d.processDefinitionKey,
        name = d.processDefinitionId,
        deploymentTime = None,
        engineType = Some(EngineType.C8),
        version = Some(d.version)
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
      result: C8RestModel.DeploymentResult
  ): DeploymentResult =
    DeploymentResult(
      deploymentId = result.deploymentKey,
      name = name,
      engineType = engineType,
      deploymentTime = Instant.now(),
      deployedProcesses = result.deployments.flatMap(_.processDefinition).map: p =>
        ProcessDefinitionInfo(
          id = p.processDefinitionKey,
          key = p.processDefinitionId,
          version = p.processDefinitionVersion
        ),
      deployedDecisions = result.deployments.flatMap(_.decisionDefinition).map: d =>
        DecisionDefinitionInfo(
          id = d.decisionDefinitionKey,
          key = d.decisionDefinitionId,
          version = d.version
        ),
      deployedForms = result.deployments.flatMap(_.form).map: f =>
        FormInfo(
          id = f.formKey,
          key = f.formId,
          version = f.version
        ),
      deployedScripts = Seq.empty
    )

end C8DeploymentService
