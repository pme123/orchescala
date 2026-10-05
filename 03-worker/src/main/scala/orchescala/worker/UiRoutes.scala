package orchescala.worker

import zio.*
import zio.http.*

import java.net.URLDecoder
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import scala.util.{Try, Using}

/** Serves the UI bundle of the worker app - the built web app (e.g. Vite) on the classpath under
  * `ui/`.
  *
  * The gateway forwards `GET /app/{projectName}/...` to `GET /ui/...` of the worker app, so UI and
  * API of a project are one deployable. A worker app without `ui/index.html` on the classpath
  * answers every request with 404.
  *
  *   - `GET /ui` and `GET /ui/` - `ui/index.html`
  *   - `GET /ui/{path}` - the file `ui/{path}`. A route of the single page app (a deep link) gets
  *     `ui/index.html`: a path without file extension, or a page request (`Accept: text/html`) for
  *     a file that does not exist, e.g. `/ui/users/john.doe`.
  *
  * Files below `assets/` carry a content hash in their name and are cached for a year, everything
  * else is revalidated on every load (`ETag`, answered with 304 when unchanged).
  *
  * The bundle is built with the base path the browser sees, e.g. Vite `base:
  * '/app/myCompany-myProject/'`.
  */
object UiRoutes:

  private[worker] val indexFile = "ui/index.html"

  private case class UiFile(bytes: Array[Byte], etag: String)

  // the files of a deployed bundle do not change - only found files are kept
  private val files = ConcurrentHashMap[String, UiFile]()

  def routes: Routes[Any, Response] =
    Routes(
      Method.GET / "ui"            -> handler((request: Request) => serve(Seq.empty, request)),
      Method.GET / "ui" / trailing -> handler { (path: Path, request: Request) =>
        serve(path.segments, request)
      }
    )

  /** Decodes the percent-escaped segments of a path (`my%20logo.svg` → `my logo.svg`) - None if a
    * segment is invalid or would leave its folder once decoded (`%2e%2e`, `a%2Fb`).
    */
  def decodeSegments(segments: Seq[String]): Option[Seq[String]] =
    val decoded = segments.filter(_.nonEmpty).map: segment =>
      // URLDecoder is for forms - a literal '+' in a path is a '+', not a space
      Try(URLDecoder.decode(segment.replace("+", "%2B"), UTF_8)).toOption
    Option.when(decoded.forall(_.exists(isSafeSegment)))(decoded.flatten)

  private[worker] def isSafeSegment(segment: String): Boolean =
    segment.nonEmpty && segment != "." && segment != ".." &&
      !segment.exists(c => c == '/' || c == '\\' || c.isControl)

  /** The classpath resources to try for a path below `/ui/`, in this order. */
  private[worker] def candidates(path: Seq[String], acceptsHtml: Boolean): Seq[String] =
    path.lastOption match
      case None                               => Seq(indexFile)
      case Some(last) if !last.contains('.')  => Seq(indexFile)
      case _ if path.head == "assets"         => Seq(s"ui/${path.mkString("/")}")
      case _                                  =>
        s"ui/${path.mkString("/")}" +: Option.when(acceptsHtml)(indexFile).toSeq

  private[worker] def cacheControl(resource: String): String =
    if resource.startsWith("ui/assets/") then "public, max-age=31536000, immutable"
    else "no-cache"

  private def serve(segments: Seq[String], request: Request): UIO[Response] =
    decodeSegments(segments) match
      case None       => ZIO.succeed(Response.status(Status.NotFound))
      case Some(path) =>
        val acceptsHtml = request.rawHeader("Accept").exists(_.contains("text/html"))
        ZIO
          .attemptBlocking(candidates(path, acceptsHtml).view.flatMap(r => load(r).map(r -> _)).headOption)
          .map:
            case None                 => Response.status(Status.NotFound)
            case Some((resource, file)) => response(resource, file, request)
          .catchAll: err =>
            ZIO.logError(s"UI file /ui/${path.mkString("/")} cannot be read: ${err.getMessage}")
              .as(Response.status(Status.InternalServerError))

  private def load(resource: String): Option[UiFile] =
    Option(files.get(resource)).orElse:
      Option(getClass.getClassLoader.getResourceAsStream(resource)).map: stream =>
        val bytes = Using.resource(stream)(_.readAllBytes())
        val file  = UiFile(bytes, etag(bytes))
        files.put(resource, file)
        file

  private def etag(bytes: Array[Byte]): String =
    val hash = MessageDigest.getInstance("SHA-256").digest(bytes)
    "\"" + Base64.getUrlEncoder.withoutPadding.encodeToString(hash).take(22) + "\""

  private def response(resource: String, file: UiFile, request: Request): Response =
    val ext       = resource.split('.').lastOption.getOrElse("")
    val mediaType = MediaType.forFileExtension(ext).getOrElse(MediaType.application.`octet-stream`)
    val headers   = Headers(
      Header.ContentType(mediaType),
      Header.Custom("Cache-Control", cacheControl(resource)),
      Header.Custom("ETag", file.etag),
      Header.Custom("X-Content-Type-Options", "nosniff")
    )
    if request.rawHeader("If-None-Match").exists(_.split(',').map(_.trim).contains(file.etag)) then
      Response(status = Status.NotModified, headers = headers)
    else Response(body = Body.fromArray(file.bytes), headers = headers)
  end response

end UiRoutes
