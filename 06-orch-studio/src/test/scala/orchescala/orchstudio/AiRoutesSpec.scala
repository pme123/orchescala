package orchescala.orchstudio

import io.circe.parser.parse
import zio.*
import zio.http.*
import zio.test.*

object AiRoutesSpec extends ZIOSpecDefault:

  /** What the fake Claude API saw of a request. */
  final case class Seen(headers: Headers, query: QueryParams, body: String)

  private val answer = """{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Hallo"}]}"""

  /** A fake Claude API on a free port: answers `answer` - or 401 for the key «bad». */
  private def fakeApi(seen: Ref[Option[Seen]]) =
    Server.install(Routes(
      Method.POST / "v1" / "messages" -> handler((r: Request) =>
        for
          body <- r.body.asString.orDie
          _    <- seen.set(Some(Seen(r.headers, r.url.queryParams, body)))
        yield
          if r.rawHeader("x-api-key").contains("bad") then
            Response.json("""{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}""").status(Status.Unauthorized)
          else Response.json(answer).addHeader(Header.Custom("request-id", "req_1"))
      )
    ))

  private def config(port: Int, key: String = "sk-ant-studio") =
    AiConfig(apiKey = key, workspaceId = Some("wrkspc_1"), model = "claude-test", baseUrl = s"http://localhost:$port")

  private def routes(ai: Option[AiConfig]) =
    ZIO.serviceWithZIO[Client](AiRoutes.make(ai, _)).map(_.routes)

  /** A request as the SDK in the browser sends it - with a key of its own that must not count. */
  private def fromBrowser(body: String, task: Option[String] = Some("uiCreator")) =
    Request.post(URL.decode("/ai/anthropic/v1/messages?beta=true").toOption.get, Body.fromString(body))
      .addHeaders(Headers(task.map(Header.Custom(AiRoutes.taskHeader, _)).toSeq))
      .addHeaders(Headers(
        Header.Custom("x-api-key", "from-the-browser"),
        Header.Custom("anthropic-version", "2023-06-01"),
        Header.Custom("anthropic-beta", "server-side-fallback-2026-07-01")
      ))

  private val body = """{"model":"claude-opus-5-5","max_tokens":100000,"messages":[{"role":"user","content":"Hallo"}]}"""

  private val withServer = Server.defaultWith(c => StudioServer.serverConfig(c.binding("localhost", 0)))

  def spec = suite("AiRoutes")(
    test("GET /ai/config - on with provider, model and the tasks with a skill, never the key; off without a key"):
      for
        on    <- routes(Some(config(1))).flatMap(_.runZIO(Request.get(URL.decode("/ai/config").toOption.get)))
        onB   <- on.body.asString
        off   <- routes(None).flatMap(_.runZIO(Request.get(URL.decode("/ai/config").toOption.get)))
        offB  <- off.body.asString
      yield assertTrue(
        onB == """{"enabled":true,"provider":"anthropic","model":"claude-test","tasks":["uiCreator"]}""",
        !onB.contains("sk-ant"),
        offB == """{"enabled":false}"""
      )
    ,
    test("POST /ai/anthropic/v1/messages - with the key, workspace and model of the studio; the answer as it is"):
      for
        seen   <- Ref.make(Option.empty[Seen])
        port   <- fakeApi(seen)
        r      <- routes(Some(config(port))).flatMap(_.runZIO(fromBrowser(body)))
        rBody  <- r.body.asString
        got    <- seen.get.someOrFailException
        sent   <- ZIO.fromEither(parse(got.body))
      yield assertTrue(
        r.status == Status.Ok,
        rBody == answer,
        r.rawHeader("request-id").contains("req_1"),
        got.headers.rawHeader("x-api-key").contains("sk-ant-studio"),
        got.headers.rawHeader("anthropic-workspace-id").contains("wrkspc_1"),
        got.headers.rawHeader("anthropic-beta").contains("server-side-fallback-2026-07-01"),
        got.headers.rawHeader("anthropic-version").contains("2023-06-01"),
        got.query.queryParam("beta").contains("true"),
        got.headers.rawHeader(AiRoutes.taskHeader).isEmpty, // only for the studio
        sent.hcursor.get[String]("model").contains("claude-test"),
        sent.hcursor.get[Int]("max_tokens").contains(AiRoutes.maxTokens),
        sent.hcursor.downField("messages").focus.exists(_.isArray)
      )
    ,
    test("an error of the Claude API goes back as it is - the SDK in the browser reads it"):
      for
        seen  <- Ref.make(Option.empty[Seen])
        port  <- fakeApi(seen)
        r     <- routes(Some(config(port, key = "bad"))).flatMap(_.runZIO(fromBrowser(body)))
        b     <- r.body.asString
      yield assertTrue(r.status == Status.Unauthorized, b.contains("authentication_error"))
    ,
    test("the AI off - 404 with the message orch-spec recognizes, nothing sent"):
      for
        r <- routes(None).flatMap(_.runZIO(fromBrowser(body)))
        b <- r.body.asString
      yield assertTrue(r.status == Status.NotFound, b.contains(AiRoutes.offMessage), b.contains("not_found_error"))
    ,
    test("no JSON, no object, too large - 400 / 413 in the form of the API, nothing sent"):
      for
        seen   <- Ref.make(Option.empty[Seen])
        port   <- fakeApi(seen)
        rs     <- routes(Some(config(port)))
        noJson <- rs.runZIO(fromBrowser("{"))
        noObj  <- rs.runZIO(fromBrowser("[1]"))
        big    <- rs.runZIO(fromBrowser(" " * (AiRoutes.maxBody + 1)))
        nb     <- noJson.body.asString
        sent   <- seen.get
      yield assertTrue(
        noJson.status == Status.BadRequest, nb.contains("invalid_request_error"),
        noObj.status == Status.BadRequest,
        big.status == Status.RequestEntityTooLarge,
        sent.isEmpty
      )
    ,
    test("a task without a skill, an unknown one or none - 403, nothing sent"):
      for
        seen    <- Ref.make(Option.empty[Seen])
        port    <- fakeApi(seen)
        rs      <- routes(Some(config(port)))
        process <- rs.runZIO(fromBrowser(body, Some("processCreator")))
        unknown <- rs.runZIO(fromBrowser(body, Some("whatever")))
        none    <- rs.runZIO(fromBrowser(body, None))
        pb      <- process.body.asString
        sent    <- seen.get
      yield assertTrue(
        process.status == Status.Forbidden, pb.contains(AiRoutes.noSkillMessage), pb.contains("processCreator"),
        unknown.status == Status.Forbidden,
        none.status == Status.Forbidden,
        sent.isEmpty
      )
    ,
    test("the skills on the classpath - today only uiCreator with anthropic"):
      assertTrue(
        AiSkills.available("anthropic") == Seq(AiSkills.Task.uiCreator),
        AiSkills.available("bedrock-eu").isEmpty,
        getClass.getClassLoader.getResource(AiSkills.path(AiSkills.Task.uiCreator, "anthropic")) != null
      )
    ,
    test("the Claude API not reachable - 502 in the form of the API"):
      for
        r <- routes(Some(config(1))).flatMap(_.runZIO(fromBrowser(body)))
        b <- r.body.asString
      yield assertTrue(r.status == Status.BadGateway, b.contains("api_error"))
    ,
    test("max_tokens below the cap stays; none at all gets the cap"):
      val c = config(1)
      def tokens(b: String) =
        AiRoutes.requestBody(b.getBytes("UTF-8"), c).toOption.flatMap(_.hcursor.get[Int]("max_tokens").toOption)
      assertTrue(tokens("""{"max_tokens":16000}""").contains(16000), tokens("{}").contains(AiRoutes.maxTokens))
    ,
    test("the settings from the environment - off without a key, the key never in toString"):
      val env = Map(
        "STUDIO_AI_ANTHROPIC_API_KEY"      -> " sk-ant-secret ",
        "STUDIO_AI_ANTHROPIC_WORKSPACE_ID" -> "wrkspc_9",
        "STUDIO_AI_ANTHROPIC_URL"          -> "http://gateway:8080/"
      )
      val ai = StudioConfig().withEnv(env).ai
      assertTrue(
        StudioConfig().withEnv(Map("STUDIO_AI_ANTHROPIC_API_KEY" -> "  ")).ai.isEmpty,
        ai.map(_.apiKey).contains("sk-ant-secret"),
        ai.flatMap(_.workspaceId).contains("wrkspc_9"),
        ai.map(_.model).contains(AiConfig.defaultModel),
        ai.map(_.baseUrl).contains("http://gateway:8080"),
        !StudioConfig().withEnv(env).toString.contains("secret")
      )
  ).provide(withServer, Client.default, Scope.default) @@ TestAspect.withLiveClock @@ TestAspect.sequential
