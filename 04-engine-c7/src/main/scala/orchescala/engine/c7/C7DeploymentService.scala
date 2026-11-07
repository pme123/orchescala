package orchescala.engine.c7

import com.fasterxml.jackson.core.`type`.TypeReference
import orchescala.engine.domain.*
import orchescala.engine.EngineConfig
import orchescala.engine.services.{DeploymentService, ManifestResolver, RepositoryManifestResolver}
import org.camunda.community.rest.client.dto.{CountResultDto, DecisionDefinitionDto, DeploymentDto, DeploymentWithDefinitionsDto, ProcessDefinitionDto}
import org.camunda.community.rest.client.invoker.{ApiClient, Pair}
import org.camunda.community.rest.client.api.DeploymentApi
import zio.ZIO.{logDebug, logInfo, logWarning}
import zio.{IO, ZIO}

import java.nio.file.{Files, Path, Paths}
import java.time.Instant
import java.util.{ArrayList, HashMap, StringJoiner}
import scala.jdk.CollectionConverters.*

class C7DeploymentService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends DeploymentService,
      C7Service:

  override protected lazy val manifestResolver: ManifestResolver =
    RepositoryManifestResolver(
      "camunda",
      fallbackToRoot = true,
      repositories = engineConfig.deploymentRepositories
    )

  override def deploy(
      name: String,
      resources: Seq[DeploymentResource],
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, DeploymentResult] =
    val deployableResources = resources.filter(_.resourceType != DeploymentResourceType.Form)

    for
      _         <- validateTargetEngine(targetEngine)
      _         <- DeploymentResource.uniqueFileNames(deployableResources)
      _         <- logDebug(s"Deploying '$name' to C7 with ${resources.size} resources")
      _         <- ZIO
                      .when(resources.exists(_.resourceType == DeploymentResourceType.Form)):
                        logWarning(
                          "Form resources are ignored for C7 deployments in the current implementation"
                        )
      apiClient <- apiClientZIO
      result    <-
        if deployableResources.isEmpty then
          ZIO.fail(
            EngineError.ProcessError(
              s"No deployable resources found for deployment '$name'"
            )
          )
        else
          ZIO.scoped:
            ZIO
              .acquireRelease(createTempResources(deployableResources))(deleteTempResources)
              .flatMap: resourceFiles =>
                ZIO.attemptBlocking:
                  val formParams = new HashMap[String, Object]()
                  Option(engineConfig.tenantId.orNull).foreach(formParams.put("tenant-id", _))
                  formParams.put("deployment-source", "orchescala-deployment")
                  // an unchanged resource is not deployed again - no new version on every deploy (e.g.
                  // a worker app's deploy on start), like Zeebe, which skips an identical resource
                  formParams.put("deploy-changed-only", Boolean.box(true))
                  formParams.put("enable-duplicate-filtering", Boolean.box(true))
                  formParams.put("deployment-name", name)
                  resourceFiles.zipWithIndex.foreach: (file, index) =>
                    formParams.put(s"data-$index", file.toFile)

                  val deployment = apiClient.invokeAPI(
                    "/deployment/create",
                    "POST",
                    new ArrayList[Pair](),
                    new ArrayList[Pair](),
                    new StringJoiner("&").toString,
                    null,
                    new HashMap[String, String](),
                    new HashMap[String, String](),
                    formParams,
                    "application/json",
                    "multipart/form-data",
                    Array("basicAuth"),
                    new TypeReference[DeploymentWithDefinitionsDto]() {}
                  )
                  val result              = mapDeploymentResult(deployment)
                  val expectedDefinitions = deployableResources.exists: resource =>
                    resource.resourceType == DeploymentResourceType.Bpmn ||
                      resource.resourceType == DeploymentResourceType.Dmn
                  // no definitions: nothing changed - with duplicate filtering C7 answers with the
                  // existing deployment, which has its definitions. A deployment without any did not
                  // pick up the resources - an error, as before.
                  if expectedDefinitions && result.deployedProcesses.isEmpty && result.deployedDecisions.isEmpty &&
                    definitionCount(apiClient, result.deploymentId) == 0
                  then
                    throw RuntimeException(
                      s"C7 accepted deployment '$name' but it has no process or decision definitions"
                    )
                  result
              .mapError: err =>
                C7Service.withStatus(err)(EngineError.ProcessError(s"Problem deploying '$name' to C7: $err"))
              .tap: result =>
                ZIO.when(result.deployedProcesses.isEmpty && result.deployedDecisions.isEmpty):
                  logInfo(s"'$name' is unchanged - nothing deployed to C7")
    yield result
  end deploy

  /** The process and decision definitions of a deployment. */
  private def definitionCount(apiClient: ApiClient, deploymentId: String): Long =
    Seq("/process-definition/count", "/decision-definition/count")
      .map: path =>
        val query = new ArrayList[Pair]()
        query.add(new Pair("deploymentId", deploymentId))
        val count = apiClient.invokeAPI(
          path,
          "GET",
          query,
          new ArrayList[Pair](),
          new StringJoiner("&").toString,
          null,
          new HashMap[String, String](),
          new HashMap[String, String](),
          new HashMap[String, Object](),
          "application/json",
          "application/json",
          Array("basicAuth"),
          new TypeReference[CountResultDto]() {}
        )
        Option(count).flatMap(c => Option(c.getCount)).map(_.longValue).getOrElse(0L)
      .sum

  override def getDeployments(
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentInfo]] =
    for
      _         <- validateTargetEngine(targetEngine)
      apiClient <- apiClientZIO
      dtos      <- ZIO
                    .attemptBlocking:
                      new DeploymentApi(apiClient)
                        .getDeployments(
                          null, null, null, null, null, null, null, null,
                          null, null, null, null, null, null
                        )
                        .asScala
                        .toSeq
                    .mapError: err =>
                      C7Service.withStatus(err)(EngineError.ProcessError(s"Problem getting deployments from C7: $err"))
    yield dtos.map(mapDeploymentInfo)
  end getDeployments

  override def deleteDeployment(
      deploymentId: String,
      cascade: Boolean = false,
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Unit] =
    for
      _         <- validateTargetEngine(targetEngine)
      apiClient <- apiClientZIO
      _         <- ZIO
                    .attemptBlocking:
                      new DeploymentApi(apiClient)
                        .deleteDeployment(deploymentId, cascade, false, false)
                    .mapError: err =>
                      C7Service.withStatus(err)(EngineError.ProcessError(
                        s"Problem deleting deployment '$deploymentId' from C7: $err"
                      ))
    yield ()
  end deleteDeployment

  private def validateTargetEngine(targetEngine: Option[EngineType]): IO[EngineError, Unit] =
    targetEngine match
      case Some(target) if target != engineType =>
        ZIO.fail(
          EngineError.UnexpectedError(
            s"${getClass.getSimpleName} only supports EngineType.$engineType, got $target"
          )
        )
      case _ => ZIO.unit

  private def createTempResources(resources: Seq[DeploymentResource]): IO[EngineError, Seq[Path]] =
    ZIO.attemptBlocking:
      val directory = Files.createTempDirectory("orchescala-deploy-")
      resources.map: resource =>
        val fileName = Paths.get(resource.name).getFileName.toString
        val path     = directory.resolve(fileName)
        Files.write(path, resource.content)
    .mapError: err =>
      C7Service.withStatus(err)(EngineError.ProcessError(s"Problem creating temporary deployment resources: $err"))

  private def deleteTempResources(paths: Seq[Path]): IO[Nothing, Unit] =
    ZIO.attemptBlocking:
      paths.foreach(Files.deleteIfExists)
      paths.headOption.map(_.getParent).foreach(Files.deleteIfExists)
    .ignore

  private def mapDeploymentResult(deployment: org.camunda.community.rest.client.dto.DeploymentWithDefinitionsDto): DeploymentResult =
    DeploymentResult(
      deploymentId = deployment.getId,
      name = deployment.getName,
      engineType = engineType,
      deploymentTime = Option(deployment.getDeploymentTime)
        .map(_.toInstant)
        .getOrElse(Instant.now()),
      deployedProcesses = Option(deployment.getDeployedProcessDefinitions)
        .map(_.values.asScala.toSeq)
        .getOrElse(Seq.empty)
        .map(mapProcessDefinition),
      deployedDecisions = Option(deployment.getDeployedDecisionDefinitions)
        .map(_.values.asScala.toSeq)
        .getOrElse(Seq.empty)
        .map(mapDecisionDefinition),
      deployedForms = Seq.empty, // Forms are not yet supported for C7 deployments
      deployedScripts = Seq.empty // Script metadata is not returned separately by the C7 deployment API
    )

  private def mapProcessDefinition(dto: ProcessDefinitionDto): ProcessDefinitionInfo =
    ProcessDefinitionInfo(
      id = dto.getId,
      key = dto.getKey,
      version = Option(dto.getVersion).map(_.intValue()).getOrElse(0)
    )

  private def mapDecisionDefinition(dto: DecisionDefinitionDto): DecisionDefinitionInfo =
    DecisionDefinitionInfo(
      id = dto.getId,
      key = dto.getKey,
      version = Option(dto.getVersion).map(_.intValue()).getOrElse(0)
    )

  private def mapDeploymentInfo(dto: DeploymentDto): DeploymentInfo =
    DeploymentInfo(
      id = dto.getId,
      name = dto.getName,
      deploymentTime = Option(dto.getDeploymentTime).map(_.toInstant),
      engineType = Some(engineType)
    )

end C7DeploymentService
