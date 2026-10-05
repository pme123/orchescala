package orchescala.worker

import zio.*
import zio.http.*

import scala.util.Using

/** Serves the UI bundle of the worker app - the built web app (e.g. Vite) on the classpath under
  * `ui/`.
  *
  * The gateway forwards `GET /app/{projectName}/...` to `GET /ui/...` of the worker app, so UI and
  * API of a project are one deployable. A worker app without `ui/index.html` on the classpath
  * answers every request with 404.
  *
  *   - `GET /ui` and `GET /ui/` - `ui/index.html`
  *   - `GET /ui/{path}` - the file `ui/{path}`. A path without file extension is a route of the
  *     single page app (a deep link) and gets `ui/index.html`.
  *
  * Files below `assets/` carry a content hash in their name and are cached for a year, everything
  * else is revalidated on every load.
  *
  * The bundle is built with the base path the browser sees, e.g. Vite `base:
  * '/app/myCompany-myProject/'`.
  */
object UiRoutes:

  private[worker] val indexFile = "ui/index.html"

  def routes: Routes[Any, Response] =
    Routes(
      Method.GET / "ui"            -> handler(serve("")),
      Method.GET / "ui" / trailing -> handler { (path: Path, _: Request) =>
        serve(path.segments.mkString("/"))
      }
    )

  private def serve(relativePath: String): UIO[Response] =
    resolve(relativePath) match
      case None           => ZIO.succeed(Response.status(Status.NotFound))
      case Some(resource) => serveClasspathFile(resource)

  /** The classpath resource for a path below `/ui/` - None for paths that leave `ui/`. */
  private[worker] def resolve(relativePath: String): Option[String] =
    val path = relativePath.trim.stripPrefix("/").stripSuffix("/")
    if !isSafe(path) then None
    else if path.isEmpty || !hasFileExtension(path) then Some(indexFile)
    else Some(s"ui/$path")

  private[worker] def isSafe(path: String): Boolean =
    !path.contains('\\') && !path.contains('\u0000') &&
      path.split('/').forall(segment => segment != ".." && segment != ".")

  private def hasFileExtension(path: String): Boolean =
    path.split('/').last.contains('.')

  private[worker] def cacheControl(resource: String): String =
    if resource.startsWith("ui/assets/") then "public, max-age=31536000, immutable"
    else "no-cache"

  private def serveClasspathFile(resource: String): UIO[Response] =
    ZIO.attempt {
      val ext       = resource.split('.').lastOption.getOrElse("")
      val mediaType = MediaType.forFileExtension(ext).getOrElse(MediaType.application.`octet-stream`)
      Option(getClass.getClassLoader.getResourceAsStream(resource)) match
        case None         =>
          Response.status(Status.NotFound)
        case Some(stream) =>
          val bytes = Using.resource(stream)(_.readAllBytes())
          Response(
            body = Body.fromArray(bytes),
            headers = Headers(
              Header.ContentType(mediaType),
              Header.Custom("Cache-Control", cacheControl(resource)),
              Header.Custom("X-Content-Type-Options", "nosniff")
            )
          )
    }.catchAll(_ => ZIO.succeed(Response.status(Status.NotFound)))

end UiRoutes
