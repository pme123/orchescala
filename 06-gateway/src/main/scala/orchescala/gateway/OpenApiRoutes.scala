package orchescala.gateway

import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import sttp.client3.basicRequest
import sttp.model.Uri
import zio.*
import zio.http.*

/** Routes for serving OpenAPI documentation.
  */
class OpenApiRoutes()(using config: GatewayConfig):

  /** Creates routes for serving OpenAPI documentation.
    *
    * Provides:
    * - GET /docs - HTML documentation page (gateway)
    * - GET /docs/OpenApi.yml - OpenAPI specification in YAML format (gateway)
    * - GET /docs/openApis/{projectName} - Forwards to projectName worker app /docs
    * - GET /docs/openApis/{projectName}/OpenApi.yml - Forwards to projectName worker app /docs/OpenApi.yml
    *
    * @return ZIO HTTP routes for documentation
    */
  def routes: Routes[Any, Response] =
    Routes(
      // Serve OpenAPI YAML specification at /docs/OpenApi.yml
      Method.GET / "docs" / "OpenApi.yml" -> handler {
        val yaml = OpenApiGenerator.generateYaml
        Response.text(yaml).addHeader(Header.ContentType(MediaType.text.yaml))
      },

      // Forward docs HTML page for a project worker app
      Method.GET / "docs" / "openApis" / string("projectName") -> handler {
        (projectName: String, _: Request) =>
          forwardDocsRequest(projectName, "docs", MediaType.text.html)
      },

      // Forward OpenApi.yml for a project worker app
      Method.GET / "docs" / "openApis" / string("projectName") / "OpenApi.yml" -> handler {
        (projectName: String, _: Request) =>
          forwardDocsRequest(projectName, "docs/OpenApi.yml", MediaType.text.yaml)
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

  private def forwardDocsRequest(
      projectName: String,
      path: String,
      contentType: MediaType
  ): ZIO[Any, Nothing, Response] =
    config.docsAppUrl(projectName) match
      case None =>
        ZIO.logWarning(s"No docs URL configured for project: $projectName") *>
          ZIO.succeed(Response.status(Status.NotFound))
      case Some(baseUrl) =>
        (for
          _        <- ZIO.logInfo(s"Forwarding docs request to: $baseUrl/$path")
          uri      <- ZIO.fromEither(Uri.parse(s"$baseUrl/$path"))
                        .mapError(err => s"Invalid docs URL: $err")
          request   = basicRequest.get(uri)
          response <- ZIO.serviceWithZIO[SttpClientBackend]: backend =>
                        request.send(backend).mapError(_.getMessage)
          result   <- response.body match
                        case Right(body) =>
                          ZIO.succeed(Response.text(body).addHeader(Header.ContentType(contentType)))
                        case Left(err)   =>
                          ZIO.logError(s"Error response from docs service '$projectName': $err") *>
                            ZIO.succeed(Response.status(Status.BadGateway))
        yield result)
          .provideLayer(HttpClientProvider.live)
          .catchAll: err =>
            ZIO.logError(s"Error forwarding docs request for '$projectName': $err") *>
              ZIO.succeed(Response.status(Status.InternalServerError))

end OpenApiRoutes

