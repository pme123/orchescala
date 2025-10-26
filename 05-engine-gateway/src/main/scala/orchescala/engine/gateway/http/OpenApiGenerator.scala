package orchescala.engine.gateway.http

import sttp.apispec.openapi.{Info, OpenAPI}
import sttp.apispec.openapi.circe.yaml.*
import sttp.tapir.docs.openapi.OpenAPIDocsInterpreter

/** Generates OpenAPI specification from Tapir endpoints.
  */
object OpenApiGenerator:

  /** Generates the OpenAPI specification as a YAML string.
    *
    * @return OpenAPI specification in YAML format
    */
  def generateYaml: String =
    val openApi = generate
    openApi.toYaml

  /** Generates the OpenAPI specification.
    *
    * @return OpenAPI specification object
    */
  def generate: OpenAPI =
    val endpoints = List(
      GatewayEndpoints.startProcessAsync,
      GatewayEndpoints.getUserTaskVariables
    )

    OpenAPIDocsInterpreter()
      .toOpenAPI(
        endpoints,
        Info(
          title = "Engine Gateway API",
          version = "1.0.0",
          description = Some(
            """REST API for the Orchescala Engine Gateway.
              |
              |The Gateway automatically routes requests to the appropriate Camunda engine (C7 or C8)
              |based on the process definition and configured engines.
              |
              |## Features
              |- Automatic engine detection and routing
              |- Support for both Camunda 7 and Camunda 8
              |- Unified API across different engine versions
              |""".stripMargin
          )
        )
      )

end OpenApiGenerator

