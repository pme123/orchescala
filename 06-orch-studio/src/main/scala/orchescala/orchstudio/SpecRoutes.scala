package orchescala.orchstudio

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import orchescala.orchspec.pages.{Blocks, PageDiff}
import zio.*
import zio.http.*

/** The services of the studio on a specification - the same code that orch-spec runs in the browser
  * (orchescala-orch-spec-core, Scala.js there, the JVM here), so both compute the same:
  *
  *   - `POST /spec/pages/diff` `{"before": Page, "after": Page}` - the differences (`PageChange[]`)
  *
  * The diff grows with the product of the blocks of both pages - a page has tens of them, so a body
  * above [[maxBody]] or a page above [[maxBlocks]] is refused (413 / 400) instead of computed.
  *
  * Without login for now (PoC, the studio listens on localhost); later Entra.
  */
object SpecRoutes:

  /** A page is a few kB - 1 MB leaves room for big ones. */
  val maxBody: Int = 1024 * 1024
  /** Building blocks of one page (sections included). */
  val maxBlocks: Int = 500

  def routes: Routes[Any, Response] =
    Routes(
      Method.POST / "spec" / "pages" / "diff" -> handler((req: Request) => pageDiff(req))
    )

  private def pageDiff(req: Request): UIO[Response] =
    if req.header(Header.ContentLength).exists(_.length > maxBody) then ZIO.succeed(tooLarge)
    else
      req.body.asString.foldZIO(
        e => ZIO.succeed(badRequest(s"the body cannot be read: ${Option(e.getMessage).getOrElse(e.toString)}")),
        body =>
          if body.length > maxBody then ZIO.succeed(tooLarge)
          else
            // anything else than an Either is a bug - a 500 with the cause in the log, never a defect
            ZIO.attempt(diff(body)).foldCauseZIO(
              cause => ZIO.logWarningCause("POST /spec/pages/diff failed", cause).as(Response.status(Status.InternalServerError)),
              result => ZIO.succeed(result.fold(badRequest, json => Response.json(json.noSpaces)))
            )
      )

  /** The body `{"before": …, "after": …}` - the differences as JSON, or why not. */
  def diff(body: String): Either[String, Json] =
    for
      json   <- parse(body).left.map(e => s"the body is no JSON: ${e.message}")
      before <- page(json, "before")
      after  <- page(json, "after")
    yield PageDiff(before, after).asJson

  private def page(body: Json, name: String): Either[String, Json] =
    for
      page  <- body.hcursor.downField(name).focus.filter(_.isObject).toRight(s"`$name` is missing - a page (JSON object)")
      blocks = page.asObject.map(o => Blocks.flatten(o("body")).size).getOrElse(0)
      _     <- Either.cond(blocks <= maxBlocks, (), s"`$name` has $blocks building blocks - at most $maxBlocks")
    yield page

  private def badRequest(message: String): Response =
    Response.json(Json.obj("error" -> Json.fromString(message)).noSpaces).status(Status.BadRequest)

  private val tooLarge: Response =
    Response.json(Json.obj("error" -> Json.fromString(s"the body is larger than $maxBody bytes")).noSpaces)
      .status(Status.RequestEntityTooLarge)

end SpecRoutes
