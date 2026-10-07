package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.engine.{AuthContext, DefaultEngineConfig}
import orchescala.engine.domain.{EngineError, EngineType, MessageCorrelationResult}
import orchescala.engine.rest.OAuthConfig
import orchescala.engine.services.MessageService
import orchescala.gateway.PublicAccess.Kind
import orchescala.worker.DefaultWorkerConfig
import sttp.model.Header
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import zio.*
import zio.http.*
import zio.test.*

object PublicAccessSpec extends ZIOSpecDefault:

  private val access = PublicAccess(
    workers = Set("acme-shop-freeSlots"),
    processStarts = Set("acme-shop-bookV1"),
    messages = Set("acme-shop-bookV1-verified"),
    requestsPerMinute = 3,
    maxBodyBytes = 100
  )

  private def json(s: String) = parse(s).toOption.get

  private def clock(at: Ref[Long]): () => Long =
    () => Unsafe.unsafe(implicit u => Runtime.default.unsafe.run(at.get).getOrThrow())

  private def guard(at: Ref[Long], maxClients: Int = 100_000) = PublicGuard(access, clock(at), maxClients)

  private val login = OAuthConfig.ClientCredentials("realm", "http://sso.invalid", "client", "secret", "openid")

  /** A token whose identity provider answers with `answer` - counting the requests. */
  private class FakeToken(at: Ref[Long], answer: Either[String, String], val requests: Ref[Int])
      extends PublicToken(login, clock(at)):
    override protected def requestToken: IO[String, String] =
      requests.update(_ + 1) *> ZIO.sleep(10.millis).withClock(Clock.ClockLive) *> ZIO.fromEither(answer)

  private def fakeToken(at: Ref[Long], answer: Either[String, String]) =
    Ref.make(0).map(FakeToken(at, answer, _))

  /** A message service that remembers the token and the variables it got. */
  private class FakeMessages(got: Ref[Option[(Option[String], Option[JsonObject])]]) extends MessageService:
    def engineType: EngineType = EngineType.C7
    def sendMessage(
        name: String,
        tenantId: Option[String],
        timeToLiveInSec: Option[Int],
        businessKey: Option[String],
        processInstanceId: Option[String],
        variables: Option[JsonObject]
    ): IO[EngineError, MessageCorrelationResult] =
      AuthContext.getBearerToken.flatMap(token => got.set(Some(token -> variables))) *>
        ZIO.succeed(MessageCorrelationResult.ProcessInstance("pi-1", "pi-1", EngineType.C7))

  /** The public routes (the engine services are not reached by most of these calls). */
  private def routes(
      publicAccess: PublicAccess,
      messages: MessageService = null,
      token: Option[PublicToken] = None
  ) =
    given GatewayConfig = DefaultGatewayConfig(
      engineConfig = DefaultEngineConfig(),
      workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
      publicAccess = publicAccess
    )
    val public = new PublicRoutes(ProcessInstanceRoutes(null, null), MessageRoutes(messages)):
      override protected def newToken(l: OAuthConfig): PublicToken = token.getOrElse(super.newToken(l))
    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(public.routes)

  private def post(publicAccess: PublicAccess, path: String, body: String) =
    postTo(routes(publicAccess), path, body)

  private def postTo(r: Routes[Any, Response], path: String, body: String) =
    ZIO.scoped(r.runZIO(Request.post(URL.decode(path).toOption.get, Body.fromString(body))))

  def spec: Spec[TestEnvironment & Scope, Any] = suite("PublicAccess")(
    suite("PublicGuard")(
      test("only what is listed - per kind"):
        for at <- Ref.make(0L)
        yield
          val g = guard(at)
          assertTrue(
            g.check(Kind.worker, "acme-shop-freeSlots", "a", "{}").isRight,
            g.check(Kind.worker, "acme-shop-other", "b", "{}").left.map(_.errorCode) == Left(404),
            // a process key is no worker topic
            g.check(Kind.worker, "acme-shop-bookV1", "c", "{}").left.map(_.errorCode) == Left(404),
            g.check(Kind.processStart, "acme-shop-bookV1", "d", "{}").isRight,
            g.check(Kind.message, "acme-shop-bookV1-verified", "e", "{}").isRight
          )
      ,
      test("the honeypot: filled in - refused; empty - removed before the call"):
        for at <- Ref.make(0L)
        yield
          val g = guard(at)
          assertTrue(
            g.check(Kind.worker, "acme-shop-freeSlots", "a", """{"topic":"x","_hp":"I am a bot"}""")
              .left.map(_.errorCode) == Left(400),
            g.check(Kind.worker, "acme-shop-freeSlots", "b", """{"topic":"x","_hp":""}""") == Right(json("""{"topic":"x"}""")),
            g.check(Kind.worker, "acme-shop-freeSlots", "c", """{"topic":"x","_hp":null}""") == Right(json("""{"topic":"x"}""")),
            // anything else is filled in
            List("false", "0", "[]", "{}", "\" \"").forall: v =>
              g.check(Kind.worker, "acme-shop-freeSlots", s"d$v", s"""{"_hp":$v}""").left.map(_.errorCode) == Left(400)
            ,
            // a body that is no object has no honeypot
            g.check(Kind.worker, "acme-shop-freeSlots", "e", "[1]") == Right(json("[1]"))
          )
      ,
      test("the general variables (mocking, output mapping, identity, ...) - refused"):
        for at <- Ref.make(0L)
        yield
          val g = guard(at)
          assertTrue(
            List("_servicesMocked", "_mockedWorkers", "_outputMock", "_identityCorrelation", "servicesMocked")
              .forall: field =>
                g.check(Kind.processStart, "acme-shop-bookV1", field, s"""{"$field":true}""").left.map(_.errorCode) == Left(400)
          )
      ,
      test("a broken body - 400, after the limit (it counts)"):
        for at <- Ref.make(0L)
        yield
          val g      = guard(at)
          val broken = (1 to 3).map(_ => g.check(Kind.worker, "acme-shop-freeSlots", "a", "{not json").left.map(_.errorCode))
          assertTrue(
            broken.forall(_ == Left(400)),
            g.check(Kind.worker, "acme-shop-freeSlots", "a", "{}").left.map(_.errorCode) == Left(429),
            g.check(Kind.message, "acme-shop-bookV1-verified", "b", "") == Right(json("{}"))
          )
      ,
      test("at most maxClients at once - a new one beyond is a 429; past minutes are swept once a minute"):
        for
          at    <- Ref.make(0L)
          g      = guard(at, maxClients = 3)
          first <- ZIO.succeed((1 to 3).map(i => g.check(Kind.worker, "acme-shop-freeSlots", s"c$i", "{}").isRight))
          fourth = g.check(Kind.worker, "acme-shop-freeSlots", "c4", "{}").left.map(_.errorCode)
          known  = g.check(Kind.worker, "acme-shop-freeSlots", "c1", "{}").isRight
          _     <- at.set(61 * 1000L)
          later  = g.check(Kind.worker, "acme-shop-freeSlots", "c4", "{}").isRight
        yield assertTrue(first.forall(identity), fourth == Left(429), known, later, g.clients == 1)
      ,
      test("the rate limit per client and minute - unknown names count as well"):
        for
          at     <- Ref.make(0L)
          g       = guard(at)
          first  <- ZIO.succeed((1 to 3).map(_ => g.check(Kind.worker, "acme-shop-unknown", "a", "{}").left.map(_.errorCode)))
          fourth  = g.check(Kind.worker, "acme-shop-freeSlots", "a", "{}").left.map(_.errorCode)
          other   = g.check(Kind.worker, "acme-shop-freeSlots", "b", "{}").isRight
          _      <- at.set(61 * 1000L)
          later   = g.check(Kind.worker, "acme-shop-freeSlots", "a", "{}").isRight
        yield assertTrue(first.forall(_ == Left(404)), fourth == Left(429), other, later)
      ,
      test("the client: the first entry of clientIpHeader - else the remote address"):
        val behindProxy = access.copy(clientIpHeader = Some("X-Forwarded-For"))
        assertTrue(
          behindProxy.client(Some("10.0.0.1"), Seq(Header("x-forwarded-for", " 1.2.3.4 , 5.6.7.8"))) == "1.2.3.4",
          behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", ""))) == "10.0.0.1",
          behindProxy.client(Some("10.0.0.1"), Seq.empty) == "10.0.0.1",
          // without clientIpHeader the header is ignored - a client could fake it
          access.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "1.2.3.4"))) == "10.0.0.1",
          access.client(None, Seq.empty) == "unknown"
        )
    ),
    suite("PublicToken")(
      test("kept until shortly before it expires - at most 30 seconds, at most half its time"):
        for
          at       <- Ref.make(0L)
          long     <- fakeToken(at, Right("""{"access_token":"t1","expires_in":300}"""))
          short    <- fakeToken(at, Right("""{"access_token":"t2","expires_in":20}"""))
          _        <- long.token *> short.token
          _        <- at.set(9 * 1000L)
          _        <- long.token *> short.token // short: still within 20 - 10 seconds
          _        <- at.set(11 * 1000L)
          _        <- long.token *> short.token // short: renewed
          _        <- at.set(271 * 1000L)
          _        <- long.token                // long: renewed after 300 - 30 seconds
          longReq  <- long.requests.get
          shortReq <- short.requests.get
        yield assertTrue(longReq == 2, shortReq == 2)
      ,
      test("without expires_in: 60 seconds"):
        for
          at    <- Ref.make(0L)
          t     <- fakeToken(at, Right("""{"access_token":"t1"}"""))
          token <- t.token
          _     <- at.set(29 * 1000L) *> t.token
          _     <- at.set(31 * 1000L) *> t.token
          req   <- t.requests.get
        yield assertTrue(token == "t1", req == 2)
      ,
      test("many calls at once - one fetch"):
        for
          at     <- Ref.make(0L)
          t      <- fakeToken(at, Right("""{"access_token":"t1","expires_in":300}"""))
          tokens <- ZIO.foreachPar(1 to 20)(_ => t.token)
          req    <- t.requests.get
        yield assertTrue(tokens.forall(_ == "t1"), req == 1)
      ,
      test("a failed login - a generic 503, and no new try for a few seconds"):
        for
          at     <- Ref.make(0L)
          t      <- fakeToken(at, Left("connection refused: http://sso.internal:8080"))
          bad    <- fakeToken(at, Right("<html>oops</html>"))
          first  <- t.token.either
          second <- t.token.either
          _      <- at.set(6 * 1000L)
          third  <- t.token.either
          req    <- t.requests.get
          parse  <- bad.token.either
        yield assertTrue(
          first == Left(PublicAccess.unavailable),
          second == Left(PublicAccess.unavailable),
          third == Left(PublicAccess.unavailable),
          req == 2,
          parse == Left(PublicAccess.unavailable)
        )
    ),
    suite("PublicRoutes")(
      test("without PublicAccess there is nothing under /public"):
        for response <- post(PublicAccess.none, "/public/worker/acme-shop-freeSlots", "{}")
        yield assertTrue(response.status == Status.NotFound)
      ,
      test("not listed - 404, without asking for a token"):
        for response <- post(access, "/public/worker/acme-shop-secret", "{}")
        yield assertTrue(response.status == Status.NotFound)
      ,
      test("the honeypot - 400 before anything is called"):
        for response <- post(access, "/public/process/acme-shop-bookV1/async", """{"_hp":"x"}""")
        yield assertTrue(response.status == Status.BadRequest)
      ,
      test("a public message needs the business key - missing or blank"):
        for
          missing <- post(access, "/public/message/acme-shop-bookV1-verified", "{}")
          blank   <- post(access, "/public/message/acme-shop-bookV1-verified?businessKey=%20", "{}")
        yield assertTrue(missing.status == Status.BadRequest, blank.status == Status.BadRequest)
      ,
      test("a body that is too large - 413, before anything is called"):
        val big = s"""{"text":"${"x" * 200}"}"""
        for response <- post(access, "/public/process/acme-shop-bookV1/async", big)
        yield assertTrue(response.status == Status.RequestEntityTooLarge)
      ,
      test("listed, but the gateway has no login - a generic 503, not a call without token"):
        for
          response <- post(access, "/public/worker/acme-shop-freeSlots", "{}")
          body     <- response.body.asString
        yield assertTrue(response.status == Status.ServiceUnavailable, !body.contains("login"))
      ,
      test("listed - forwarded with the technical token, without the honeypot field"):
        for
          at       <- Ref.make(0L)
          token    <- fakeToken(at, Right("""{"access_token":"tech-token","expires_in":300}"""))
          got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          r         = routes(access.copy(login = Some(login)), FakeMessages(got), Some(token))
          response <- postTo(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-1", """{"ok":true,"_hp":""}""")
          sent     <- got.get
        yield assertTrue(
          response.status == Status.Ok,
          sent == Some(Some("tech-token") -> json("""{"ok":true}""").asObject)
        )
    )
  )
end PublicAccessSpec
