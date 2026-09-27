package orchescala.gateway

import io.circe.Json
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.model.StatusCode
import sttp.tapir.*
import sttp.tapir.json.circe.*

object DeploymentEndpoints:

  lazy val postDeployments: Endpoint[
    String,
    (Option[String], Json),
    ServiceRequestError,
    Json,
    Any
  ] =
    EndpointsUtil.baseEndpoint
      .post
      .in("deployment")
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

  lazy val getDeployments: Endpoint[
    String,
    Option[String],
    ServiceRequestError,
    Json,
    Any
  ] =
    EndpointsUtil.baseEndpoint
      .get
      .in("deployment")
      .in(
        query[Option[String]]("targetEngine")
          .description("Optional target engine: C7, C8, Op, Gateway")
          .example(Some("C8"))
      )
      .out(statusCode(StatusCode.Ok))
      .out(
        jsonBody[Json]
          .description("List of deployments")
          .example(getDeploymentsExample)
      )
      .name("Get Deployments")
      .summary("List what is deployed")
      .description(
        """Lists the deployments - the check after `POST /deployment`. With `targetEngine` of that
          |engine, without of all engines (each entry has its `engineType`; an engine that cannot be
          |reached is left out and logged - the request only fails if no engine answers).
          |
          |- C7 / Op: one entry per deployment (`id` = deployment id, `name` = deployment name,
          |  `deploymentTime` set).
          |- C8: Zeebe has no deployment entity, so one entry per deployed process definition
          |  (`id` = processDefinitionKey, `name` = bpmn process id, `version` set).
          |""".stripMargin
      )
      .tag(apiGroup)

  private lazy val apiGroup = "Deployment"

  private lazy val getDeploymentsExample: Json =
    Json.arr(
      Json.obj(
        "id"             -> Json.fromString("2251799813685249"),
        "name"           -> Json.fromString("mycompany-myproject-myProcess"),
        "deploymentTime" -> Json.Null,
        "engineType"     -> Json.fromString("C8"),
        "version"        -> Json.fromInt(3)
      )
    )

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
