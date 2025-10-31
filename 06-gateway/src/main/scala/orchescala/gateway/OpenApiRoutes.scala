package orchescala.gateway

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
      // Serve OpenAPI YAML specification at /docs/openapi.yml
      Method.GET / "docs" / "openapi.yml" -> handler {
        val yaml = OpenApiGenerator.generateYaml
        Response.text(yaml).addHeader(Header.ContentType(MediaType.text.yaml))
      },
      
      // Also serve at root level for HTML compatibility
      Method.GET / "openapi.yml" -> handler {
        val yaml = OpenApiGenerator.generateYaml
        Response.text(yaml).addHeader(Header.ContentType(MediaType.text.yaml))
      },
      
      // Serve favicon
      Method.GET / "favicon.ico" -> handler {
        ZIO.attempt {
          val faviconBytes = scala.io.Source
            .fromResource("favicon.ico")(using scala.io.Codec.ISO8859)
            .map(_.toByte)
            .toArray
          Response(
            body = Body.fromArray(faviconBytes),
            headers = Headers(Header.ContentType(MediaType.image.`x-icon`))
          )
        }.catchAll { error =>
          ZIO.succeed(Response.status(Status.NotFound))
        }
      },
      
      // Serve HTML documentation page
      Method.GET / "docs" -> handler {
        ZIO.attempt {
          val htmlContent = scala.io.Source
            .fromResource("OpenApi.html")
            .mkString
          Response.text(htmlContent).addHeader(Header.ContentType(MediaType.text.html))
        }.catchAll { error =>
          ZIO.succeed(
            Response.text(s"Error loading documentation: ${error.getMessage}")
              .status(Status.InternalServerError)
          )
        }
      }
    )

end OpenApiRoutes

