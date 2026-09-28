package orchescala.gateway

import io.circe.{Decoder, Json, JsonObject}
import orchescala.engine.domain.*
import orchescala.engine.services.DeploymentService
import orchescala.engine.{AuthContext, EngineConfig}
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.capabilities.WebSockets
import sttp.capabilities.zio.ZioStreams
import sttp.tapir.ztapir.*
import zio.*

case class DeploymentRoutes(deploymentService: DeploymentService)(using config: GatewayConfig):

  lazy val routes: List[ZServerEndpoint[Any, ZioStreams & WebSockets]] =
    List(postDeploymentsEndpoint, getDeploymentsEndpoint)

  private lazy val getDeploymentsEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    DeploymentEndpoints.getDeployments.zServerSecurityLogic { token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    }.serverLogic { validatedToken => targetEngineStr =>
      ZIO.logDebug("Get deployments request received") *>
        AuthContext.withBearerToken(validatedToken):
          for
            targetEngine <- parseTargetEngine(targetEngineStr)
            infos        <- deploymentService
                              .getDeployments(targetEngine)
                              .mapError(ServiceRequestError.apply)
          yield Json.arr(infos.map(infoAsJson)*)
    }

  private def infoAsJson(info: DeploymentInfo): Json =
    Json.obj(
      "id"             -> Json.fromString(info.id),
      "name"           -> Json.fromString(info.name),
      "deploymentTime" -> info.deploymentTime.fold(Json.Null)(t => Json.fromString(t.toString)),
      "engineType"     -> info.engineType.fold(Json.Null)(e => Json.fromString(e.toString)),
      "version"        -> info.version.fold(Json.Null)(Json.fromInt)
    )

  private lazy val postDeploymentsEndpoint: ZServerEndpoint[Any, ZioStreams & WebSockets] =
    DeploymentEndpoints.postDeployments.zServerSecurityLogic { token =>
      config.validateToken(token).mapError(ServiceRequestError.apply)
    }.serverLogic { validatedToken =>
      (targetEngineStr, body) =>
        ZIO.logDebug("POST Deployments request received") *>
          AuthContext.withBearerToken(validatedToken):
            for
              targetEngine <- parseTargetEngine(targetEngineStr)
              manifest     <- parseManifest(body)
              results      <- deploymentService
                                .postDeployments(manifest, targetEngine)
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
            // a wrong request - it was a 500 (UnexpectedError)
            ServiceRequestError(400, s"Invalid targetEngine '$value'. Valid values: C7, C8, Op, Gateway")

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
          ServiceRequestError(400, s"Invalid manifest: ${failure.getMessage}")
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
