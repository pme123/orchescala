package orchescala.orchstudio

import io.circe.{Json, JsonObject}
import io.circe.parser.parse
import zio.*
import zio.http.*

/** The AI of the studio (E23), first step: the key is on the server, orch-spec runs its agent as
  * before and sends each request of it through here.
  *
  *   - `GET /ai/config` - `{"enabled": true, "provider": "anthropic", "model": …, "tasks": [...]}` or
  *     `{"enabled": false}`; never the key. orch-spec shows the AI of a task only if it is in
  *     `tasks` - the tasks with a skill (see [[AiSkills]]).
  *   - `POST /ai/anthropic/v1/messages` - a request of the Messages API for the task in the header
  *     `x-orch-task`, sent on with the key (and workspace) of the studio. A task without a skill is
  *     refused (403). The studio decides the model and caps `max_tokens`; the answer - also an
  *     error of the API - goes back as it is, so the SDK in the browser reads it as usual.
  *
  * Later: a service per task (`POST /ai/uiCreator` …) with its skill from the resources, the agent
  * on the server, and `GET /ai/tasks` with what a person may use. Without login for now (PoC, the
  * studio listens on localhost) - whoever reaches the studio uses its key.
  */
final class AiRoutes private (ai: Option[AiConfig], tasks: Seq[AiSkills.Task], client: Client, running: Semaphore):
  import AiRoutes.*

  def routes: Routes[Any, Response] =
    Routes(
      Method.GET / "ai" / "config"                             -> handler(Response.json(configJson(ai, tasks).noSpaces)),
      Method.POST / "ai" / "anthropic" / "v1" / "messages" -> handler((req: Request) => messages(req))
    )

  private def messages(req: Request): UIO[Response] =
    ai match
      case None                                                               => ZIO.succeed(off)
      case Some(_) if req.header(Header.ContentLength).exists(_.length > maxBody) => ZIO.succeed(tooLarge)
      case Some(_) if !taskOf(req).exists(tasks.contains)                      => ZIO.succeed(noSkill(req.rawHeader(taskHeader)))
      case Some(config)                                                       =>
        req.body.asArray.foldZIO(
          e => ZIO.succeed(apiError(Status.BadRequest, "invalid_request_error", s"the body cannot be read: ${message(e)}")),
          bytes =>
            if bytes.length > maxBody then ZIO.succeed(tooLarge)
            else
              requestBody(bytes, config) match
                case Left(error) => ZIO.succeed(apiError(Status.BadRequest, "invalid_request_error", error))
                case Right(body) => running.withPermit(forward(req, body, config))
        )

  /** To the Claude API with the key of the studio - its answer as it is. */
  private def forward(req: Request, body: Json, config: AiConfig): UIO[Response] =
    val url = URL.decode(s"${config.baseUrl}/v1/messages").toOption.get
      .copy(queryParams = req.url.queryParams) // `?beta=true` of the SDK
    val headers = Headers(
      Header.Custom("x-api-key", config.apiKey),
      Header.Custom("anthropic-version", req.rawHeader("anthropic-version").getOrElse(anthropicVersion)),
      Header.ContentType(MediaType.application.json)
    ) ++ Headers(
      req.rawHeader("anthropic-beta").map(Header.Custom("anthropic-beta", _)).toSeq ++
        config.workspaceId.map(Header.Custom("anthropic-workspace-id", _)).toSeq
    )
    val call =
      for
        start    <- Clock.nanoTime
        response <- client.batched(Request.post(url, Body.fromString(body.noSpaces)).addHeaders(headers))
        bytes    <- response.body.asArray
        took     <- Clock.nanoTime.map(n => (n - start) / 1_000_000)
        _        <- ZIO.logInfo(s"POST /ai/anthropic/v1/messages - ${config.model}: ${response.status.code} in $took ms")
      yield Response(
        status = response.status,
        headers = Headers(Header.ContentType(MediaType.application.json)) ++
          Headers(response.rawHeader("request-id").map(Header.Custom("request-id", _)).toSeq),
        body = Body.fromArray(bytes)
      )
    call
      .timeoutFail(TimeoutAfter)(timeout)
      .catchAllCause: cause =>
        val (status, kind, text) =
          if cause.failureOption.contains(TimeoutAfter) then (Status.GatewayTimeout, "timeout_error", s"no answer of the Claude API within $timeout")
          else (Status.BadGateway, "api_error", "the Claude API cannot be reached from the studio")
        ZIO.logWarningCause(s"POST /ai/anthropic/v1/messages - $text", cause).as(apiError(status, kind, text))
  end forward

end AiRoutes

object AiRoutes:

  /** The request of the browser holds the spec (pages, data model, catalog) and the chat - a few
    * 100 kB; 8 MB leaves room. The server reads no more (see [[StudioServer.serverConfig]]).
    */
  val maxBody: Int = 8 * 1024 * 1024
  /** The most a request may ask for - orch-spec asks 16000; a larger value is capped. */
  val maxTokens: Int = 32000
  /** Requests to the API at the same time - more wait. */
  val maxParallel: Int = 8
  /** A request with thinking can take minutes; the SDK in the browser waits 10. */
  val timeout: Duration = 10.minutes
  val anthropicVersion = "2023-06-01"

  /** The header with the task of a request - orch-spec sets it per chat. */
  val taskHeader = "x-orch-task"
  val provider   = "anthropic"

  /** `tasks`: the tasks with a skill - by default the ones on the classpath. */
  def make(ai: Option[AiConfig], client: Client, tasks: => Seq[AiSkills.Task] = AiSkills.available(provider)): UIO[AiRoutes] =
    Semaphore.make(maxParallel.toLong).map(AiRoutes(ai, if ai.isDefined then tasks else Nil, client, _))

  /** What orch-spec may know: on or off, provider, model and the tasks - never the key. */
  def configJson(ai: Option[AiConfig], tasks: Seq[AiSkills.Task]): Json =
    ai.fold(Json.obj("enabled" -> Json.False)): c =>
      Json.obj(
        "enabled"  -> Json.True,
        "provider" -> Json.fromString(provider),
        "model"    -> Json.fromString(c.model),
        "tasks"    -> Json.arr(tasks.map(t => Json.fromString(t.id))*)
      )

  private def taskOf(req: Request): Option[AiSkills.Task] =
    req.rawHeader(taskHeader).flatMap(id => AiSkills.Task.values.find(_.id == id.trim))

  /** The body for the API: the model of the studio, `max_tokens` at most [[maxTokens]]. */
  def requestBody(bytes: Array[Byte], config: AiConfig): Either[String, Json] =
    for
      text <- scala.util.Try(
                java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                  .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                  .decode(java.nio.ByteBuffer.wrap(bytes)).toString
              ).toEither.left.map(_ => "the body is no UTF-8")
      json <- parse(text).left.map(e => s"the body is no JSON: ${e.message}")
      obj  <- json.asObject.toRight("the body is no JSON object")
    yield
      val tokens = obj("max_tokens").flatMap(_.asNumber).flatMap(_.toInt).map(_.min(maxTokens)).getOrElse(maxTokens)
      Json.fromJsonObject(obj.add("model", Json.fromString(config.model)).add("max_tokens", Json.fromInt(tokens)))

  private case object TimeoutAfter

  private def message(e: Throwable) = Option(e.getMessage).getOrElse(e.toString)

  /** An error in the form of the Claude API - the SDK in the browser reads it like one of the API. */
  private def apiError(status: Status, kind: String, text: String): Response =
    Response.json(
      Json.obj(
        "type"  -> Json.fromString("error"),
        "error" -> Json.fromJsonObject(JsonObject("type" -> Json.fromString(kind), "message" -> Json.fromString(text)))
      ).noSpaces
    ).status(status)

  /** The message orch-spec recognizes: the AI was switched off on the server meanwhile. */
  val offMessage = "the AI of the studio is off (STUDIO_AI_ANTHROPIC_API_KEY)"

  private val off      = apiError(Status.NotFound, "not_found_error", offMessage)

  /** The message orch-spec recognizes: the task has no skill in the studio. */
  val noSkillMessage = "no skill in the studio for the task"

  private def noSkill(task: Option[String]) =
    apiError(Status.Forbidden, "permission_error", s"$noSkillMessage «${task.getOrElse("")}» ($taskHeader)")
  private val tooLarge = apiError(Status.RequestEntityTooLarge, "request_too_large", s"the body is larger than $maxBody bytes")

end AiRoutes
