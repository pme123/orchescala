package orchescala.engine.gateway.http

import zio.*
import zio.http.*

/** Routes for serving OpenAPI documentation.
  */
object OpenApiRoutes:

  /** Creates routes for serving OpenAPI documentation.
    *
    * Provides:
    * - GET /docs - HTML documentation page
    * - GET /docs/openapi.yml - OpenAPI specification in YAML format
    *
    * @return ZIO HTTP routes for documentation
    */
  def routes: Routes[Any, Response] =
    Routes(
      // Serve OpenAPI YAML specification
      Method.GET / "docs" / "openapi.yml" -> handler {
        val yaml = OpenApiGenerator.generateYaml
        Response.text(yaml).addHeader(Header.ContentType(MediaType.text.yaml))
      },
      
      // Serve HTML documentation page
      Method.GET / "docs" -> handler {
        ZIO.attempt {
          val htmlContent = scala.io.Source
            .fromResource("OpenApi.html")
            .mkString
          Response.html(htmlContent)
        }.catchAll { error =>
          ZIO.succeed(
            Response.text(s"Error loading documentation: ${error.getMessage}")
              .status(Status.InternalServerError)
          )
        }
      }
    )

end OpenApiRoutes

