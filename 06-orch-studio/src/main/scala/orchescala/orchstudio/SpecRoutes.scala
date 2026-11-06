package orchescala.orchstudio

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import orchescala.orchspec.pages.PageDiff
import zio.*
import zio.http.*

/** The services of the studio on a specification - the same code that orch-spec runs in the browser
  * (orchescala-orch-spec-core, Scala.js there, the JVM here), so both compute the same:
  *
  *   - `POST /spec/pages/diff` `{"before": Page, "after": Page}` - the differences (`PageChange[]`)
  *
  * Without login for now (PoC, the studio listens on localhost); later Entra.
  */
object SpecRoutes:

  def routes: Routes[Any, Response] =
    Routes(
      Method.POST / "spec" / "pages" / "diff" -> handler((req: Request) => pageDiff(req))
    )

  private def pageDiff(req: Request): UIO[Response] =
    req.body.asString
      .mapError(e => s"the body cannot be read: ${e.getMessage}")
      .flatMap(body => ZIO.fromEither(diff(body)))
      .fold(badRequest, json => Response.json(json.noSpaces))

  /** The body `{"before": …, "after": …}` - the differences as JSON, or why not. */
  def diff(body: String): Either[String, Json] =
    for
      json   <- parse(body).left.map(e => s"the body is no JSON: ${e.message}")
      before <- page(json, "before")
      after  <- page(json, "after")
    yield PageDiff(before, after).asJson

  private def page(body: Json, name: String): Either[String, Json] =
    body.hcursor.downField(name).focus.filter(_.isObject).toRight(s"`$name` is missing - a page (JSON object)")

  private def badRequest(message: String): Response =
    Response.json(Json.obj("error" -> Json.fromString(message)).noSpaces).status(Status.BadRequest)

end SpecRoutes
