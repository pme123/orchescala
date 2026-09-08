package orchescala.engine.c7

import orchescala.engine.domain.*
import orchescala.engine.EngineConfig
import orchescala.engine.services.{ClasspathManifestResolver, DeploymentService, ManifestResolver}
import org.camunda.community.rest.client.api.DeploymentApi
import org.camunda.community.rest.client.dto.{DecisionDefinitionDto, DeploymentDto, ProcessDefinitionDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logWarning}
import zio.{IO, ZIO}

import java.io.ByteArrayOutputStream
import java.nio.file.{Files, Path}
import java.time.Instant
import java.util.zip.{ZipEntry, ZipOutputStream}
import scala.jdk.CollectionConverters.*

class C7DeploymentService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends DeploymentService,
      C7Service:

  override protected lazy val manifestResolver: ManifestResolver = ClasspathManifestResolver()

  override def deploy(
      name: String,
      resources: Seq[DeploymentResource],
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, DeploymentResult] =
    val deployableResources = resources.filter(_.resourceType != DeploymentResourceType.Form)

    for
      _         <- validateTargetEngine(targetEngine)
      _         <- logDebug(s"Deploying '$name' to C7 with ${resources.size} resources")
      _         <- ZIO
                      .when(resources.exists(_.resourceType == DeploymentResourceType.Form)):
                        logWarning(
                          "Form resources are ignored for C7 deployments in the current implementation"
                        )
      apiClient <- apiClientZIO
      result    <-
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
          ZIO.scoped:
            ZIO
              .acquireRelease(createTempZip(deployableResources))(deleteTempFile)
              .flatMap: path =>
                ZIO.attempt:
                  val deployment = new DeploymentApi(apiClient)
                    .createDeployment(
                      engineConfig.tenantId.orNull,
                      "orchescala-deployment",
                      false,
                      false,
                      name,
                      null,
                      path.toFile
                    )
                  mapDeploymentResult(deployment)
              .mapError: err =>
                EngineError.ProcessError(s"Problem deploying '$name' to C7: $err")
    yield result
  end deploy

  override def getDeployments(
      targetEngine: Option[EngineType] = None
  ): IO[EngineError, Seq[DeploymentInfo]] =
    for
      _         <- validateTargetEngine(targetEngine)
      apiClient <- apiClientZIO
      dtos      <- ZIO
                    .attempt:
                      new DeploymentApi(apiClient)
                        .getDeployments(
                          null, null, null, null, null, null, null, null,
                          null, null, null, null, null, null
                        )
                        .asScala
                        .toSeq
                    .mapError: err =>
                      EngineError.ProcessError(s"Problem getting deployments from C7: $err")
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
                    .attempt:
                      new DeploymentApi(apiClient)
                        .deleteDeployment(deploymentId, cascade, false, false)
                    .mapError: err =>
                      EngineError.ProcessError(
                        s"Problem deleting deployment '$deploymentId' from C7: $err"
                      )
    yield ()
  end deleteDeployment

  private def validateTargetEngine(targetEngine: Option[EngineType]): IO[EngineError, Unit] =
    targetEngine match
      case Some(engineType) if engineType != EngineType.C7 =>
        ZIO.fail(
          EngineError.UnexpectedError(
            s"C7DeploymentService only supports EngineType.C7, got $engineType"
          )
        )
      case _ => ZIO.unit

  private def createTempZip(resources: Seq[DeploymentResource]): IO[EngineError, Path] =
    ZIO.attempt:
      val path   = Files.createTempFile("orchescala-deploy-", ".zip")
      val buffer = new ByteArrayOutputStream()
      val zipOut = new ZipOutputStream(buffer)
      resources.foreach: resource =>
        val entry = new ZipEntry(resource.name)
        zipOut.putNextEntry(entry)
        zipOut.write(resource.content)
        zipOut.closeEntry()
      zipOut.close()
      Files.write(path, buffer.toByteArray)
      path
    .mapError: err =>
      EngineError.ProcessError(s"Problem creating deployment zip: $err")

  private def deleteTempFile(path: Path): IO[Nothing, Unit] =
    ZIO.attempt(Files.deleteIfExists(path)).ignore

  private def mapDeploymentResult(deployment: org.camunda.community.rest.client.dto.DeploymentWithDefinitionsDto): DeploymentResult =
    DeploymentResult(
      deploymentId = deployment.getId,
      name = deployment.getName,
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
      deploymentTime = Option(dto.getDeploymentTime).map(_.toInstant)
    )

end C7DeploymentService
