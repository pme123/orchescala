package orchescala.gateway

import io.circe.{Decoder, Json, JsonObject}
import orchescala.engine.domain.*
import orchescala.engine.services.DeploymentService
import orchescala.engine.{AuthContext, EngineConfig}
import orchescala.gateway.GatewayError.{ServiceRequestError, UnexpectedError}
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.ztapir.*
import zio.*

case class DeploymentRoutes(deploymentService: DeploymentService)(using config: GatewayConfig):

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    List(deployManifestEndpoint)

  private lazy val deployManifestEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    DeploymentEndpoints.deployManifest.zServerSecurityLogic { token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    }.serverLogic { validatedToken =>
      (targetEngineStr, body) =>
        ZIO.logDebug("Deploy manifest request received") *>
          AuthContext.withBearerToken(validatedToken):
            for
              targetEngine <- parseTargetEngine(targetEngineStr)
              manifest     <- parseManifest(body)
              results      <- deploymentService
                                .deployManifest(manifest, targetEngine)
                                .mapError(ServiceRequestError.apply)
            yield resultsAsJson(results)
    }

  private def parseTargetEngine(
      str: Option[String]
  ): IO[ServiceRequestError, Option[EngineType]] =
    str match
      case None => ZIO.none
      case Some(value) =>
        ZIO
          .attempt(Some(EngineType.valueOf(value)))
          .mapError: _ =>
            ServiceRequestError(
              UnexpectedError(s"Invalid targetEngine '$value'. Valid values: C7, C8, Op, Gateway")
            )

  private given Decoder[DeploymentEntry] = Decoder.instance: c =>
    for
      company <- c.get[String]("company")
      project <- c.get[String]("project")
      version <- c.get[String]("version")
    yield DeploymentEntry(company, project, version)

  private given Decoder[DeploymentManifest] = Decoder.instance: c =>
    c.get[Seq[DeploymentEntry]]("deployments").map(DeploymentManifest(_))

  private def parseManifest(json: Json): IO[ServiceRequestError, DeploymentManifest] =
    json.as[DeploymentManifest] match
      case Left(failure) =>
        ZIO.fail(
          ServiceRequestError(UnexpectedError(s"Invalid manifest: ${failure.getMessage}"))
        )
      case Right(manifest) =>
        ZIO.succeed(manifest)

  private def resultsAsJson(results: Seq[DeploymentResult]): Json =
    Json.arr(results.map(resultAsJson)*)

  private def resultAsJson(result: DeploymentResult): Json =
    Json.obj(
      "deploymentId"    -> Json.fromString(result.deploymentId),
      "name"            -> Json.fromString(result.name),
      "engineType"      -> Json.fromString(result.engineType.toString),
      "deploymentTime"  -> Json.fromString(result.deploymentTime.toString),
      "deployedProcesses" -> Json.arr(
        result.deployedProcesses.map: p =>
          Json.obj(
            "id"      -> Json.fromString(p.id),
            "key"     -> Json.fromString(p.key),
            "version" -> Json.fromInt(p.version)
          )
        *
      ),
      "deployedDecisions" -> Json.arr(
        result.deployedDecisions.map: d =>
          Json.obj(
            "id"      -> Json.fromString(d.id),
            "key"     -> Json.fromString(d.key),
            "version" -> Json.fromInt(d.version)
          )
        *
      ),
      "deployedForms" -> Json.arr(
        result.deployedForms.map: f =>
          Json.obj(
            "id"      -> Json.fromString(f.id),
            "key"     -> Json.fromString(f.key),
            "version" -> Json.fromInt(f.version)
          )
        *
      ),
      "deployedScripts" -> Json.arr(
        result.deployedScripts.map: s =>
          Json.obj(
            "id"           -> Json.fromString(s.id),
            "resourceName" -> Json.fromString(s.resourceName)
          )
        *
      )
    )

end DeploymentRoutes
