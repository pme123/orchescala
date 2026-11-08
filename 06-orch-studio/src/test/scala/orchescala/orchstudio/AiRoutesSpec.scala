package orchescala.orchstudio

import io.circe.Json
import io.circe.parser.parse
import zio.*
import zio.http.*
import zio.test.*

object AiRoutesSpec extends ZIOSpecDefault:

  /** What the fake Claude API saw of a request. */
  final case class Seen(headers: Headers, query: QueryParams, body: String)

  private val answer =
    """{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Hallo"}],"usage":{"input_tokens":12,"output_tokens":3}}"""

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

  /** A skill of the test - its settings differ from those the browser sends. */
  private val skill = AiSkills.Skill(
    task = AiSkills.Task.uiCreator,
    provider = "anthropic",
    name = "uiCreator-test",
    version = 2,
    model = Some("claude-skill"),
    maxTokens = Some(16000),
    thinking = Some("adaptive"),
    effort = Some("medium"),
    fallbacks = Some("default"),
    tools = Seq("read_page", "check_page"),
    instructions = "Do as the skill says."
  )

  private def routes(ai: Option[AiConfig], skills: Seq[AiSkills.Skill] = Seq(skill)) =
    ZIO.serviceWithZIO[Client](AiRoutes.make(ai, _, skills)).map(_.routes)

  /** A request as the SDK in the browser sends it - with a key of its own that must not count. */
  private def fromBrowser(body: String, task: String = "uiCreator") =
    Request.post(URL.decode(s"/ai/$task/v1/messages?beta=true").toOption.get, Body.fromString(body))
      .addHeaders(Headers(
        Header.Custom("x-api-key", "from-the-browser"),
        Header.Custom("anthropic-version", "2023-06-01"),
        Header.Custom("anthropic-beta", s"${AiRoutes.fallbackBeta}, other-beta")
      ))

  /** What orch-spec sends: the context as system (no instructions), its tools, its settings. */
  private val body =
    """{"model":"claude-opus-5-5","max_tokens":100000,
      |"system":[{"type":"text","text":"the catalog","cache_control":{"type":"ephemeral"}}],
      |"tools":[{"name":"read_page","input_schema":{"type":"object"}}],
      |"output_config":{"effort":"high"},
      |"messages":[{"role":"user","content":"Hallo"}]}""".stripMargin

  private val withServer = Server.defaultWith(c => StudioServer.serverConfig(c.binding("localhost", 0)))

  private def get(path: String) = Request.get(URL.decode(path).toOption.get)

  def spec = suite("AiRoutes")(
    test("GET /ai/config - on with provider, model and the tasks with their skill, never the key; off without a key"):
      for
        on   <- routes(Some(config(1))).flatMap(_.runZIO(get("/ai/config")))
        onB  <- on.body.asString
        off  <- routes(None).flatMap(_.runZIO(get("/ai/config")))
        offB <- off.body.asString
      yield assertTrue(
        onB == """{"enabled":true,"provider":"anthropic","model":"claude-test","tasks":["uiCreator"],""" +
          """"skills":{"uiCreator":{"name":"uiCreator-test","version":2,"model":"claude-skill"}}}""",
        !onB.contains("sk-ant"),
        offB == """{"enabled":false}"""
      )
    ,
    test("POST /ai/uiCreator/v1/messages - the key and workspace of the studio, the skill applied; the answer as it is"):
      for
        seen  <- Ref.make(Option.empty[Seen])
        port  <- fakeApi(seen)
        r     <- routes(Some(config(port))).flatMap(_.runZIO(fromBrowser(body)))
        rBody <- r.body.asString
        got   <- seen.get.someOrFailException
        sent  <- ZIO.fromEither(parse(got.body))
        c      = sent.hcursor
      yield assertTrue(
        r.status == Status.Ok,
        rBody == answer,
        r.rawHeader("request-id").contains("req_1"),
        got.headers.rawHeader("x-api-key").contains("sk-ant-studio"),
        got.headers.rawHeader("anthropic-workspace-id").contains("wrkspc_1"),
        got.headers.rawHeader("anthropic-beta").contains(s"${AiRoutes.fallbackBeta},other-beta"),
        got.headers.rawHeader("anthropic-version").contains("2023-06-01"),
        got.query.queryParam("beta").contains("true"),
        // the skill: model, settings, its instructions first - the context of the browser after them
        c.get[String]("model").contains("claude-skill"),
        c.get[Int]("max_tokens").contains(16000),
        c.downField("thinking").get[String]("type").contains("adaptive"),
        c.downField("output_config").get[String]("effort").contains("medium"),
        c.get[String]("fallbacks").contains("default"),
        c.downField("system").downN(0).get[String]("text").contains("Do as the skill says."),
        c.downField("system").downN(0).downField("cache_control").focus.isEmpty,
        c.downField("system").downN(1).get[String]("text").contains("the catalog"),
        c.downField("system").downN(1).downField("cache_control").focus.isDefined,
        c.downField("messages").focus.exists(_.isArray)
      )
    ,
    test("the fallback beta is set for a skill with fallbacks - also if the browser sends none"):
      for
        seen <- Ref.make(Option.empty[Seen])
        port <- fakeApi(seen)
        rs   <- routes(Some(config(port)))
        _    <- rs.runZIO(Request.post(URL.decode("/ai/uiCreator/v1/messages").toOption.get, Body.fromString(body)))
        got  <- seen.get.someOrFailException
      yield assertTrue(got.headers.rawHeader("anthropic-beta").contains(AiRoutes.fallbackBeta))
    ,
    test("an error of the Claude API goes back as it is - the SDK in the browser reads it"):
      for
        seen <- Ref.make(Option.empty[Seen])
        port <- fakeApi(seen)
        r    <- routes(Some(config(port, key = "bad"))).flatMap(_.runZIO(fromBrowser(body)))
        b    <- r.body.asString
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
    test("a tool that is not in the skill or has no name - 400 that names it, nothing sent"):
      val other  = body.replace(""""name":"read_page"""", """"name":"remove_block"""")
      val noName = body.replace(""""name":"read_page",""", "")
      for
        seen <- Ref.make(Option.empty[Seen])
        port <- fakeApi(seen)
        rs   <- routes(Some(config(port)))
        r    <- rs.runZIO(fromBrowser(other))
        b    <- r.body.asString
        n    <- rs.runZIO(fromBrowser(noName))
        nb   <- n.body.asString
        sent <- seen.get
      yield assertTrue(
        r.status == Status.BadRequest, b.contains("«remove_block»"), b.contains("uiCreator-test v2"),
        n.status == Status.BadRequest, nb.contains("(without name)"),
        sent.isEmpty
      )
    ,
    test("a task without a skill, an unknown one, the old route - 403, nothing sent"):
      for
        seen    <- Ref.make(Option.empty[Seen])
        port    <- fakeApi(seen)
        rs      <- routes(Some(config(port)))
        process <- rs.runZIO(fromBrowser(body, "processCreator"))
        unknown <- rs.runZIO(fromBrowser(body, "whatever"))
        old     <- rs.runZIO(fromBrowser(body, "anthropic"))
        pb      <- process.body.asString
        sent    <- seen.get
      yield assertTrue(
        process.status == Status.Forbidden, pb.contains(AiRoutes.noSkillMessage), pb.contains("processCreator"),
        unknown.status == Status.Forbidden,
        old.status == Status.Forbidden,
        sent.isEmpty
      )
    ,
    test("the system of the browser - a text, none or something else"):
      def system(b: String) =
        AiRoutes.requestBody(b.getBytes("UTF-8"), config(1), skill).map(_.hcursor.downField("system").focus.flatMap(_.asArray).getOrElse(Vector.empty))
      val texts = (b: String) => system(b).map(_.flatMap(_.hcursor.get[String]("text").toOption))
      assertTrue(
        texts("""{"system":"the context"}""") == Right(Vector("Do as the skill says.", "the context")),
        texts("{}") == Right(Vector("Do as the skill says.")),
        system("""{"system":5}""").isLeft
      )
    ,
    test("max_tokens: at most what the skill allows - and never more than the cap of the studio"):
      def tokens(b: String, s: AiSkills.Skill = skill) =
        AiRoutes.requestBody(b.getBytes("UTF-8"), config(1), s).toOption.flatMap(_.hcursor.get[Int]("max_tokens").toOption)
      assertTrue(
        tokens("""{"max_tokens":8000}""").contains(8000),
        tokens("{}").contains(16000),
        tokens("{}", skill.copy(maxTokens = None)).contains(AiRoutes.maxTokens),
        tokens("""{"max_tokens":50000}""", skill.copy(maxTokens = Some(50000))).contains(AiRoutes.maxTokens)
      )
    ,
    test("a skill without model and settings - the model of the studio, the settings of the browser"):
      val bare = skill.copy(model = None, thinking = None, effort = None, fallbacks = None)
      val sent = AiRoutes.requestBody(body.getBytes("UTF-8"), config(1), bare).toOption.map(_.hcursor)
      assertTrue(
        sent.flatMap(_.get[String]("model").toOption).contains("claude-test"),
        sent.flatMap(_.downField("output_config").get[String]("effort").toOption).contains("high"),
        sent.exists(_.downField("thinking").focus.isEmpty),
        AiRoutes.configJson(Some(config(1)), Seq(bare)).hcursor.downField("skills").downField("uiCreator").get[String]("model")
          .contains("claude-test")
      )
    ,
    test("the skills on the classpath - today only uiCreator with anthropic, its instructions without comments"):
      val loaded = AiSkills.load("anthropic")
      val ui     = loaded.toOption.flatMap(_.headOption)
      assertTrue(
        loaded.map(_.map(_.task)) == Right(Seq(AiSkills.Task.uiCreator)),
        AiSkills.load("bedrock-eu") == Right(Nil),
        ui.map(_.name).contains("uiCreator-anthropic"),
        ui.flatMap(_.model).contains("claude-opus-5-5"),
        ui.flatMap(_.maxTokens).contains(16000),
        ui.flatMap(_.effort).contains("medium"),
        ui.map(_.tools).contains(Seq(
          "read_page", "insert_block", "update_block", "move_block", "remove_block", "update_page", "check_page", "report_open_point"
        )),
        ui.exists(_.instructions.startsWith("You help a requirements engineer")),
        ui.exists(_.instructions.endsWith("No JSON in the answer.")),
        !ui.exists(_.instructions.contains("<!--"))
      )
    ,
    test("a SKILL.md that is not complete - the reason, so the start can name it"):
      val ok = "---\nname: x\ntools: [a]\n---\n\n## Instructions\n\nDo it.\n"
      def parsed(t: String) = AiSkills.parse(AiSkills.Task.uiCreator, "anthropic", t)
      assertTrue(
        parsed(ok).map(_.instructions) == Right("Do it."),
        parsed(ok).map(_.version) == Right(1),
        parsed("# no front matter").left.exists(_.contains("front matter")),
        parsed(ok.replace("name: x\n", "")).left.exists(_.contains("no name")),
        parsed(ok.replace("tools: [a]\n", "")).left.exists(_.contains("tools")),
        parsed(ok.replace("name: x", "name: x\ntask: processCreator")).left.exists(_.contains("processCreator")),
        parsed(ok.replace("Do it.", "<!-- only a note -->")).left.exists(_.contains("Instructions")),
        parsed(ok.replace("tools: [a]", "tools: [a\n")).left.exists(_.contains("YAML")),
        // a field with the wrong type is no silent default
        parsed(ok.replace("name: x", "name: x\nrequest:\n  max_tokens: \"16000\"")).left.exists(_.contains("«request.max_tokens»")),
        parsed(ok.replace("name: x", "name: x\nrequest:\n  max_tokens: 0")).left.exists(_.contains("more than 0")),
        parsed(ok.replace("name: x", "name: x\nversion: \"2\"")).left.exists(_.contains("«version»")),
        parsed(ok.replace("name: x", "name: x\ntask: 5")).left.exists(_.contains("«task»")),
        parsed(ok.replace("name: x", "name: x\nrequest:\n  thinking: 1")).left.exists(_.contains("«request.thinking»")),
        parsed(ok.replace("name: x", "name: x\nrequest: 5")).left.exists(_.contains("«request»")),
        parsed(ok.replace("name: x", "name: x\nrequest:\n  max_tokens: 8000\n  effort: low")).map(s => (s.maxTokens, s.effort))
          == Right((Some(8000), Some("low")))
      )
    ,
    test("a line «## …» in a code fence belongs to the instructions; the next section outside ends them"):
      val text =
        "---\nname: x\ntools: [a]\n---\n\n## Instructions\n\nBefore.\n```md\n## Heading of an example\n```\nAfter.\n\n## Notes\n\nNot for the model.\n"
      assertTrue(
        AiSkills.parse(AiSkills.Task.uiCreator, "anthropic", text).map(_.instructions) ==
          Right("Before.\n```md\n## Heading of an example\n```\nAfter.")
      )
    ,
    test("a base URL that is no http(s) URL: the start names it; set in code: 502, no defect"):
      val fromEnv = scala.util.Try(StudioConfig().withEnv(Map(
        "STUDIO_AI_ANTHROPIC_API_KEY" -> "sk-ant-x", "STUDIO_AI_ANTHROPIC_URL" -> "api.anthropic.com"
      ))).failed.toOption.map(_.getMessage)
      for
        r <- routes(Some(config(1).copy(baseUrl = "no url"))).flatMap(_.runZIO(fromBrowser(body)))
        b <- r.body.asString
      yield assertTrue(
        fromEnv.exists(_.contains("STUDIO_AI_ANTHROPIC_URL")),
        r.status == Status.BadGateway, b.contains("STUDIO_AI_ANTHROPIC_URL")
      )
    ,
    test("the Claude API not reachable - 502 in the form of the API"):
      for
        r <- routes(Some(config(1))).flatMap(_.runZIO(fromBrowser(body)))
        b <- r.body.asString
      yield assertTrue(r.status == Status.BadGateway, b.contains("api_error"))
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
