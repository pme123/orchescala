package orchescala.worker

import zio.*
import zio.http.*

/** Routes for serving OpenAPI documentation.
  */
object OpenApiRoutes:

  /** Creates routes for serving OpenAPI documentation.
    *
    * Provides:
    *   - GET /docs - HTML documentation page
    *   - GET /docs/openapi.yml - OpenAPI specification in YAML format
    *
    * @return
    *   ZIO HTTP routes for documentation
    */
  def routes: Routes[Any, Response] =
    Routes(
      // Serve OpenAPI YAML specification at /docs/openapi.yml
      Method.GET / "docs" / "OpenApi.yml"                      -> handler {
        val yaml = scala.io.Source
          .fromResource("OpenApi.yml")
          .mkString
        Response.text(yaml).addHeader(Header.ContentType(MediaType.text.yaml))
      },
      // Serve BPMNs und DMNs
      Method.GET / "diagrams" / string("diagramName") -> handler {
        (diagramName: String, _: Request) =>
          ZIO
            .attempt:
              val xml = scala.io.Source
                .fromResource(s"diagrams/$diagramName")
                .mkString
              Response.text(xml).addHeader(Header.ContentType(MediaType.application.xml))
            .catchAll: _ =>
              ZIO.succeed(Response.status(Status.NotFound))

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
