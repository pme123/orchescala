package orchescala.orchstudio

import io.circe.{Json, JsonObject}
import io.circe.parser.parse
import zio.*
import zio.http.*

/** The AI of the studio (E23): the key is on the server, orch-spec runs its agent and sends each
  * request of it through here - to the route of its task, where the studio applies the skill.
  *
  *   - `GET /ai/config` - `{"enabled": true, "provider": "anthropic", "model": …, "tasks": [...],
  *     "skills": {"uiCreator": {"name", "version", "model"}}}` or `{"enabled": false}`; never the
  *     key. orch-spec shows the AI of a task only if it is in `tasks` - the tasks with a skill (see
  *     [[AiSkills]]).
  *   - `POST /ai/<task>/v1/messages` - a request of the Messages API for the task, sent on with the
  *     key (and workspace) of the studio. A task without a skill is refused (403). The skill decides:
  *     its instructions come first in the system (orch-spec sends only the context - catalog, data
  *     model), its model and `request` settings replace those of the browser, and a tool that is not
  *     in the skill is refused (400). The answer - also an error of the API - goes back as it is, so
  *     the SDK in the browser reads it as usual.
  *
  * Later: the agent on the server with the limits of the skill (steps, corrections, costs) and
  * `GET /ai/tasks` with what a person may use. Without login for now (PoC, the studio listens on
  * localhost) - whoever reaches the studio uses its key.
  */
final class AiRoutes private (ai: Option[AiConfig], skills: Seq[AiSkills.Skill], client: Client, running: Semaphore):
  import AiRoutes.*

  def routes: Routes[Any, Response] =
    Routes(
      Method.GET / "ai" / "config"                                 -> handler(Response.json(configJson(ai, skills).noSpaces)),
      Method.POST / "ai" / string("task") / "v1" / "messages" -> handler((task: String, req: Request) => messages(task, req))
    )

  private def messages(task: String, req: Request): UIO[Response] =
    (ai, skills.find(_.task.id == task)) match
      case (None, _)                                                           => ZIO.succeed(off)
      case _ if req.header(Header.ContentLength).exists(_.length > maxBody)    => ZIO.succeed(tooLarge)
      case (Some(_), None)                                                     => ZIO.succeed(noSkill(task))
      case (Some(config), Some(skill))                                         =>
        req.body.asArray.foldZIO(
          e => ZIO.succeed(apiError(Status.BadRequest, "invalid_request_error", s"the body cannot be read: ${message(e)}")),
          bytes =>
            if bytes.length > maxBody then ZIO.succeed(tooLarge)
            else
              requestBody(bytes, config, skill) match
                case Left(error) => ZIO.succeed(apiError(Status.BadRequest, "invalid_request_error", error))
                case Right(body) => forward(req, body, config, skill)
        )

  /** To the Claude API with the key of the studio - its answer as it is. The timeout covers the wait
    * for a permit too, so a request behind slow ones does not wait without end.
    */
  private def forward(req: Request, body: Json, config: AiConfig, skill: AiSkills.Skill): UIO[Response] =
    config.messagesUrl match
      case Left(error) => ZIO.logWarning(error).as(apiError(Status.BadGateway, "api_error", error))
      case Right(base) => send(req, body, config, skill, base.copy(queryParams = req.url.queryParams)) // `?beta=true` of the SDK

  private def send(req: Request, body: Json, config: AiConfig, skill: AiSkills.Skill, url: URL): UIO[Response] =
    val path    = s"POST /ai/${skill.task.id}/v1/messages"
    // the betas of the browser and the one the skill needs
    val betas   = (req.rawHeader("anthropic-beta").toSeq.flatMap(_.split(',')).map(_.trim).filter(_.nonEmpty) ++
      skill.fallbacks.map(_ => fallbackBeta)).distinct
    val headers = Headers(
      Header.Custom("x-api-key", config.apiKey),
      Header.Custom("anthropic-version", req.rawHeader("anthropic-version").getOrElse(anthropicVersion)),
      Header.ContentType(MediaType.application.json)
    ) ++ Headers(
      Option.when(betas.nonEmpty)(Header.Custom("anthropic-beta", betas.mkString(","))).toSeq ++
        config.workspaceId.map(Header.Custom("anthropic-workspace-id", _)).toSeq
    )
    val call =
      for
        start    <- Clock.nanoTime
        response <- client.batched(Request.post(url, Body.fromString(body.noSpaces)).addHeaders(headers))
        bytes    <- response.body.asArray
        took     <- Clock.nanoTime.map(n => (n - start) / 1_000_000)
        // who asked comes with the login; no content - only skill, model, status, time and tokens
        _        <- ZIO.logInfo(s"$path - ${skill.label}, ${modelOf(config, skill)}: ${response.status.code} in $took ms${usageText(bytes)}")
      yield Response(
        status = response.status,
        headers = Headers(Header.ContentType(MediaType.application.json)) ++
          Headers(response.rawHeader("request-id").map(Header.Custom("request-id", _)).toSeq),
        body = Body.fromArray(bytes)
      )
    running.withPermit(call)
      .timeoutFail(TimeoutAfter)(timeout)
      .catchAllCause: cause =>
        // the browser went away: nobody waits for an answer - no 502, no warning
        if cause.isInterruptedOnly then ZIO.interrupt
        else
          val (status, kind, text) =
            if cause.failureOption.contains(TimeoutAfter) then (Status.GatewayTimeout, "timeout_error", s"no answer of the Claude API within $timeout")
            else (Status.BadGateway, "api_error", "the Claude API cannot be reached from the studio")
          ZIO.logWarningCause(s"$path - $text", cause).as(apiError(status, kind, text))
  end send

end AiRoutes

object AiRoutes:

  /** The request of the browser holds the spec (pages, data model, catalog) and the chat - a few
    * 100 kB; 8 MB leaves room. The server reads no more (see [[StudioServer.serverConfig]]).
    */
  val maxBody: Int = 8 * 1024 * 1024
  /** The most a request may ask for - also if a skill allows more. */
  val maxTokens: Int = 32000
  /** Requests to the API at the same time - more wait. */
  val maxParallel: Int = 8
  /** A request with thinking can take minutes; the SDK in the browser waits 10. */
  val timeout: Duration = 10.minutes
  val anthropicVersion = "2023-06-01"
  /** The beta of `fallbacks` - the studio sets it when the skill asks for fallbacks. */
  val fallbackBeta = "server-side-fallback-2026-07-01"

  val provider = "anthropic"

  /** `skills`: the skills of the tasks - none if the AI is off. */
  def make(ai: Option[AiConfig], client: Client, skills: Seq[AiSkills.Skill]): UIO[AiRoutes] =
    Semaphore.make(maxParallel.toLong).map(AiRoutes(ai, if ai.isDefined then skills else Nil, client, _))

  /** What orch-spec may know: on or off, provider, model and the tasks with their skill - never the key. */
  def configJson(ai: Option[AiConfig], skills: Seq[AiSkills.Skill]): Json =
    ai.fold(Json.obj("enabled" -> Json.False)): c =>
      Json.obj(
        "enabled"  -> Json.True,
        "provider" -> Json.fromString(provider),
        "model"    -> Json.fromString(c.model),
        "tasks"    -> Json.arr(skills.map(s => Json.fromString(s.task.id))*),
        "skills"   -> Json.obj(skills.map(s =>
          s.task.id -> Json.obj(
            "name"    -> Json.fromString(s.name),
            "version" -> Json.fromInt(s.version),
            "model"   -> Json.fromString(modelOf(c, s))
          ))*)
      )

  /** The model of the skill - or of the studio, if the skill names none. */
  def modelOf(config: AiConfig, skill: AiSkills.Skill): String = skill.model.getOrElse(config.model)

  /** The body for the API as the skill wants it: its instructions first in the system, its model and
    * settings, `max_tokens` at most what the skill (and [[maxTokens]]) allows - and only its tools.
    */
  def requestBody(bytes: Array[Byte], config: AiConfig, skill: AiSkills.Skill): Either[String, Json] =
    for
      text   <- scala.util.Try(
                  java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(bytes)).toString
                ).toEither.left.map(_ => "the body is no UTF-8")
      json   <- parse(text).left.map(e => s"the body is no JSON: ${e.message}")
      obj    <- json.asObject.toRight("the body is no JSON object")
      // the answer goes back as one JSON - a stream would be buffered and sent as JSON, which the SDK cannot read
      _      <- obj("stream").filter(_.asBoolean.contains(true)).map(_ => "the studio does not stream (stream: true)").toLeft(())
      system <- systemOf(obj("system"))
      _      <- Some(toolsOf(obj).filterNot(_.exists(skill.tools.contains)).map(_.getOrElse("(without name)"))).filter(_.nonEmpty)
                  .map(t => s"the tools ${t.map(n => s"«$n»").mkString(", ")} are not in the skill ${skill.label}").toLeft(())
    yield
      val limit  = skill.maxTokens.getOrElse(maxTokens).min(maxTokens)
      val tokens = obj("max_tokens").flatMap(_.asNumber).flatMap(_.toInt).fold(limit)(_.min(limit))
      // no breakpoint of its own: the next block (the catalog) caches it along
      val first  = Json.obj("type" -> Json.fromString("text"), "text" -> Json.fromString(skill.instructions))
      // thinking, effort and fallbacks are the skill's - without them in the skill, the defaults of the API
      val output = obj("output_config").flatMap(_.asObject).getOrElse(JsonObject.empty).remove("effort")
      val ofSkill = Seq(
        Some("model" -> Json.fromString(modelOf(config, skill))),
        Some("max_tokens" -> Json.fromInt(tokens)),
        Some("system" -> Json.arr((first +: system)*)),
        skill.thinking.map(t => "thinking" -> Json.obj("type" -> Json.fromString(t))),
        Some(skill.effort.fold(output)(e => output.add("effort", Json.fromString(e)))).filter(_.nonEmpty)
          .map(o => "output_config" -> Json.fromJsonObject(o)),
        skill.fallbacks.map(f => "fallbacks" -> Json.fromString(f))
      ).flatten
      val ofBrowser = obj.remove("thinking").remove("output_config").remove("fallbacks")
      Json.fromJsonObject(ofSkill.foldLeft(ofBrowser) { case (o, (k, v)) => o.add(k, v) })

  /** The system of the browser as blocks - a text, a list of blocks or none. */
  private def systemOf(system: Option[Json]): Either[String, Vector[Json]] =
    system match
      case None                       => Right(Vector.empty)
      case Some(j) if j.isNull        => Right(Vector.empty)
      case Some(j) if j.isString      =>
        Right(j.asString.filter(_.trim.nonEmpty).map(t => Json.obj("type" -> Json.fromString("text"), "text" -> Json.fromString(t))).toVector)
      case Some(j) if j.isArray       => Right(j.asArray.getOrElse(Vector.empty))
      case Some(_)                    => Left("the system is neither a text nor a list of blocks")

  /** The names of the tools a request offers the model - None for one without a name (refused too). */
  private def toolsOf(obj: JsonObject): Vector[Option[String]] =
    obj("tools").flatMap(_.asArray).getOrElse(Vector.empty).map(_.hcursor.get[String]("name").toOption)

  /** The tokens of an answer for the log - nothing if it has none (an error). */
  private def usageText(bytes: Array[Byte]): String =
    parse(String(bytes, java.nio.charset.StandardCharsets.UTF_8)).toOption
      .flatMap(_.hcursor.downField("usage").focus).map(_.hcursor)
      .map: u =>
        def n(f: String) = u.get[Long](f).getOrElse(0L)
        s", tokens in ${n("input_tokens")} (cache read ${n("cache_read_input_tokens")}, written ${n("cache_creation_input_tokens")}), out ${n("output_tokens")}"
      .getOrElse("")

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

  private val off = apiError(Status.NotFound, "not_found_error", offMessage)

  /** The message orch-spec recognizes: the task has no skill in the studio. */
  val noSkillMessage = "no skill in the studio for the task"

  private def noSkill(task: String) = apiError(Status.Forbidden, "permission_error", s"$noSkillMessage «$task»")
  private val tooLarge              = apiError(Status.RequestEntityTooLarge, "request_too_large", s"the body is larger than $maxBody bytes")

end AiRoutes
