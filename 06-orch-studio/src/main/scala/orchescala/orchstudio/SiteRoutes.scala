package orchescala.orchstudio

import zio.*
import zio.http.*

/** The routes of the documentation apps:
  *
  *   - `/site/…`  orch-doc with the company's documentation, orch-spec under `/site/spec/`, orch-ops under
  *                `/site/ops/` - as the gateway of Orchescala
  *   - `/`, `/spec`, `/ops`  short ways there
  *
  * Without login for now (PoC, the studio listens on localhost); later Entra.
  */
final case class SiteRoutes(site: Site):

  def routes: Routes[Any, Response] =
    Routes(
      Method.GET / ""            -> redirect("/site/"),
      Method.GET / "spec"        -> redirect("/site/spec/"),
      Method.GET / "ops"         -> redirect("/site/ops/"),
      Method.GET / "site"        -> handler((req: Request) => serve(req)),
      Method.GET / "site" / trailing -> handler((_: Path, req: Request) => serve(req)),
      // orch-spec and orch-ops ask so whether the documentation app is there (their link back)
      Method.HEAD / "site"            -> handler((req: Request) => serve(req).map(SiteRoutes.headOnly)),
      Method.HEAD / "site" / trailing -> handler((_: Path, req: Request) => serve(req).map(SiteRoutes.headOnly))
    )

  private def redirect(location: String): Handler[Any, Nothing, Any, Response] =
    Handler.succeed(SiteRoutes.found(location))

  private def serve(req: Request): UIO[Response] =
    val rest = req.url.path.encode.stripPrefix("/site")
    // reading from a folder or the jar - not on the compute pool
    ZIO.attemptBlocking(site.resolve(rest))
      .map:
        case Site.Resolved.File(rel, bytes) => SiteRoutes.file(rel, bytes)
        case Site.Resolved.Redirect(to)     => SiteRoutes.found(to)
        case Site.Resolved.NotFound         => Response.status(Status.NotFound)
      .catchAll(e => ZIO.logWarning(s"/site$rest failed: ${e.getMessage}").as(Response.status(Status.InternalServerError)))

end SiteRoutes

object SiteRoutes:

  private def headOnly(r: Response): Response = r.copy(body = Body.empty)

  private def found(location: String): Response =
    Response(status = Status.Found, headers = Headers(Header.Custom("location", location)))

  private def file(rel: String, bytes: Array[Byte]): Response =
    Response(
      body = Body.fromArray(bytes),
      headers = Headers(
        Header.Custom("content-type", contentType(rel)),
        Header.Custom("cache-control", cacheControl(rel))
      )
    )

  /** The apps' `assets/` carry a hash in the name - kept for good; everything else asked again, so a
    * new release of the apps or the documentation is there on the next reload.
    */
  private[orchstudio] def cacheControl(rel: String): String =
    if rel.split('/').init.contains("assets") then "public, max-age=31536000, immutable" else "no-cache"

  private[orchstudio] def contentType(rel: String): String =
    contentTypes.getOrElse(rel.split('.').last.toLowerCase, "application/octet-stream")

  private val contentTypes = Map(
    "html" -> "text/html; charset=utf-8", "js" -> "text/javascript; charset=utf-8",
    "mjs" -> "text/javascript; charset=utf-8", "css" -> "text/css; charset=utf-8",
    "json" -> "application/json", "map" -> "application/json", "yml" -> "text/yaml; charset=utf-8",
    "yaml" -> "text/yaml; charset=utf-8", "md" -> "text/markdown; charset=utf-8",
    "txt" -> "text/plain; charset=utf-8", "xml" -> "application/xml", "bpmn" -> "application/xml",
    "dmn" -> "application/xml", "png" -> "image/png", "jpg" -> "image/jpeg", "jpeg" -> "image/jpeg",
    "gif" -> "image/gif", "svg" -> "image/svg+xml", "ico" -> "image/x-icon", "webp" -> "image/webp",
    "woff" -> "font/woff", "woff2" -> "font/woff2", "ttf" -> "font/ttf",
    "eot" -> "application/vnd.ms-fontobject", "pdf" -> "application/pdf"
  )

end SiteRoutes
