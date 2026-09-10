package orchescala.gateway

import io.circe.Json
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.model.StatusCode
import sttp.tapir.*
import sttp.tapir.json.circe.*

object DeploymentEndpoints:

  lazy val deployManifest: Endpoint[
    String,
    (Option[String], Json),
    ServiceRequestError,
    Json,
    Any
  ] =
    EndpointsUtil.baseEndpoint
      .post
      .in("deployment")
      .in("manifest")
      .in(
        query[Option[String]]("targetEngine")
          .description("Optional target engine: C7, C8, Op, Gateway")
          .example(Some("C8"))
      )
      .in(
        jsonBody[Json]
          .description("Deployment manifest")
          .example(deployManifestExample)
      )
      .out(statusCode(StatusCode.Ok))
      .out(
        jsonBody[Json]
          .description("List of deployment results")
      )
      .name("Deploy Manifest")
      .summary("Deploy a manifest")
      .description(
        """Deploys the resources described by the manifest to the selected or auto-detected engine.
          |""".stripMargin
      )
      .tag(apiGroup)

  private lazy val apiGroup = "Deployment"

  private lazy val deployManifestExample: Json =
    Json.obj(
      "deployments" -> Json.arr(
        Json.obj(
          "company" -> Json.fromString("mycompany"),
          "project" -> Json.fromString("mycompany-myproject"),
          "version" -> Json.fromString("1.2.0")
        )
      )
    )
end DeploymentEndpoints
