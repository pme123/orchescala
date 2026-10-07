package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.engine.{AuthContext, DefaultEngineConfig}
import orchescala.engine.domain.{EngineError, EngineType, HistoricVariable, MessageCorrelationResult, ProcessInfo}
import orchescala.engine.rest.OAuthConfig
import orchescala.engine.services.{HistoricVariableService, MessageService, ProcessInstanceService}
import orchescala.gateway.PublicAccess.Kind
import orchescala.worker.DefaultWorkerConfig
import sttp.model.Header
import sttp.tapir.server.ziohttp.{ZioHttpInterpreter, ZioHttpServerOptions}
import zio.*
import zio.http.*
import zio.test.*

import java.util.concurrent.atomic.AtomicLong

object PublicAccessSpec extends ZIOSpecDefault:

  private val access = PublicAccess(
    workers = Set("acme-shop-freeSlots"),
    processStarts = Set("acme-shop-bookV1"),
    messages = Set("acme-shop-bookV1-verified"),
    requestsPerMinute = 3,
    maxBodyBytes = 100
  )

  private def json(s: String) = parse(s).toOption.get

  /** A clock the test sets. */
  private class TestClock extends (() => Long):
    private val at           = AtomicLong(0L)
    def apply(): Long        = at.get()
    def set(millis: Long): Unit = at.set(millis)

  private def guard(clock: TestClock, maxClients: Int = 100_000) = PublicGuard(access, clock, maxClients)

  private val login = OAuthConfig.ClientCredentials("realm", "http://sso.invalid", "client", "the-client-secret", "openid")

  // a JWT the gateway can read the identity from (not signed - only decoded here)
  private val techToken =
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJwcmVmZXJyZWRfdXNlcm5hbWUiOiJkZW1vLXRlY2gifQ.c2ln"

  /** A token whose identity provider answers with `answer` - counting the requests. */
  private class FakeToken(clock: TestClock, answer: Either[String, String], val requests: Ref[Int])
      extends PublicToken(login, clock):
    override protected def requestToken: IO[String, String] =
      requests.update(_ + 1) *> ZIO.sleep(10.millis).withClock(Clock.ClockLive) *> ZIO.fromEither(answer)

  private def fakeToken(clock: TestClock, answer: Either[String, String]) =
    Ref.make(0).map(FakeToken(clock, answer, _))

  private def techTokenOf(clock: TestClock) = fakeToken(clock, Right(s"""{"access_token":"$techToken","expires_in":300}"""))

  /** What a fake engine got: the token and the variables. */
  private type Got = Ref[Option[(Option[String], Option[JsonObject])]]

  private class FakeMessages(got: Got, answer: IO[EngineError, Unit]) extends MessageService:
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
        answer.as(MessageCorrelationResult.ProcessInstance("pi-1", "pi-1", EngineType.C7))

  private class FakeProcesses(got: Got) extends ProcessInstanceService:
    def engineType: EngineType = EngineType.C7
    def startProcessAsync(
        processDefId: String,
        in: JsonObject,
        businessKey: Option[String],
        tenantId: Option[String],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, ProcessInfo] =
      AuthContext.getBearerToken.flatMap(token => got.set(Some(token -> Some(in)))) *>
        ZIO.succeed(ProcessInfo("pi-1", businessKey, ProcessInfo.ProcessStatus.Active, EngineType.C7))
    def startProcessByMessage(
        messageName: String,
        businessKey: Option[String],
        tenantId: Option[String],
        variables: Option[JsonObject],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, ProcessInfo] = ZIO.fail(EngineError.UnexpectedError("not in this test"))
    def getVariablesInternal(processInstanceId: String, variableFilter: Option[Seq[String]]): IO[EngineError, Seq[JsonProperty]] =
      ZIO.fail(EngineError.UnexpectedError("not in this test"))

  private object NoHistory extends HistoricVariableService:
    def engineType: EngineType = EngineType.C7
    def getVariables(
        variableName: Option[String],
        processInstanceId: Option[String],
        variableFilter: Option[Seq[String]]
    ): IO[EngineError, Seq[HistoricVariable]] = ZIO.fail(EngineError.UnexpectedError("not in this test"))

  /** The public routes against fake engines. The worker and the init worker are not called
    * (`validateInput = false` - the variables come back as they are).
    */
  private def routes(
      publicAccess: PublicAccess,
      got: Got,
      answer: IO[EngineError, Unit] = ZIO.unit,
      token: Option[PublicToken] = None,
      clock: TestClock = TestClock()
  ) =
    given GatewayConfig = DefaultGatewayConfig(
      engineConfig = DefaultEngineConfig(validateInput = false),
      workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
      publicAccess = publicAccess
    )
    val processes = FakeProcesses(got)
    val public    = new PublicRoutes(ProcessInstanceRoutes(processes, NoHistory), MessageRoutes(FakeMessages(got, answer))):
      override protected def newGuard(a: PublicAccess): PublicGuard = PublicGuard(a, clock)
      override protected def newToken(l: OAuthConfig): PublicToken  = token.getOrElse(super.newToken(l))
    ZioHttpInterpreter(ZioHttpServerOptions.default).toHttp(public.routes)

  private def post(r: Routes[Any, Response], path: String, body: String, headers: (String, String)*) =
    val request = headers.foldLeft(Request.post(URL.decode(path).toOption.get, Body.fromString(body))):
      case (req, (name, value)) => req.addHeader(name, value)
    ZIO.scoped(r.runZIO(request))

  private def post(publicAccess: PublicAccess, path: String, body: String): ZIO[Any, Response, Response] =
    Ref.make(Option.empty[(Option[String], Option[JsonObject])]).flatMap(got => post(routes(publicAccess, got), path, body))

  def spec: Spec[TestEnvironment & Scope, Any] = suite("PublicAccess")(
    suite("PublicGuard")(
      test("only what is listed - per kind"):
        val g = guard(TestClock())
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
        val g = guard(TestClock())
        assertTrue(
          g.check(Kind.worker, "acme-shop-freeSlots", "a", """{"topic":"x","_hp":"I am a bot"}""")
            .left.map(_.errorCode) == Left(400),
          g.check(Kind.worker, "acme-shop-freeSlots", "b", """{"topic":"x","_hp":""}""") == Right(json("""{"topic":"x"}""")),
          g.check(Kind.worker, "acme-shop-freeSlots", "c", """{"topic":"x","_hp":null}""") == Right(json("""{"topic":"x"}""")),
          // anything else is filled in
          List("false", "0", "[]", "{}", "\" \"").forall: v =>
            g.check(Kind.worker, "acme-shop-freeSlots", s"d$v", s"""{"_hp":$v}""").left.map(_.errorCode) == Left(400)
        )
      ,
      test("the body: a JSON object or nothing - else 400"):
        val g = guard(TestClock())
        assertTrue(
          g.body("") == Right(JsonObject.empty),
          List("[1]", "42", "\"text\"", "null", "{not json").forall(b => g.body(b).left.map(_.errorCode) == Left(400))
        )
      ,
      test("the general variables (mocking, output mapping, identity, ...) - refused"):
        val g = guard(TestClock())
        assertTrue(
          List("_servicesMocked", "_mockedWorkers", "_outputMock", "_identityCorrelation", "servicesMocked")
            .forall: field =>
              g.check(Kind.processStart, "acme-shop-bookV1", field, s"""{"$field":true}""").left.map(_.errorCode) == Left(400)
        )
      ,
      test("the rate limit per client and minute - unknown names count as well; a new minute starts anew"):
        val clock  = TestClock()
        val g      = guard(clock)
        val first  = (1 to 3).map(_ => g.admit(Kind.worker, "acme-shop-unknown", "a").left.map(_.errorCode))
        val fourth = g.admit(Kind.worker, "acme-shop-freeSlots", "a").left.map(_.errorCode)
        val other  = g.admit(Kind.worker, "acme-shop-freeSlots", "b").isRight
        clock.set(61 * 1000L)
        val later  = g.admit(Kind.worker, "acme-shop-freeSlots", "a").isRight
        assertTrue(first.forall(_ == Left(404)), fourth == Left(429), other, later)
      ,
      test("many calls of one client at once - exactly requestsPerMinute admitted"):
        val g = guard(TestClock())
        for admitted <- ZIO.foreachPar(1 to 100)(_ => ZIO.succeed(g.admit(Kind.worker, "acme-shop-freeSlots", "a").isRight))
        yield assertTrue(admitted.count(identity) == 3)
      ,
      test("at most maxClients - beyond, the least recently used is forgotten (nobody is locked out)"):
        val clock    = TestClock()
        val g        = guard(clock, maxClients = 3)
        val admitted = (1 to 5).map(i => g.admit(Kind.worker, "acme-shop-freeSlots", s"c$i").isRight)
        val count    = g.clients
        clock.set(61 * 1000L)
        g.admit(Kind.worker, "acme-shop-freeSlots", "c6")
        assertTrue(admitted.forall(identity), count == 3, g.clients == 1, g.forgottenReport() == Some(2L), g.forgottenReport().isEmpty)
      ,
      test("the client: the last entry of clientIpHeader - else the remote address"):
        val behindProxy = access.copy(clientIpHeader = Some("X-Forwarded-For"))
        assertTrue(
          // the first entries come from the client - only the last one is set by the proxy
          behindProxy.client(Some("10.0.0.1"), Seq(Header("x-forwarded-for", "6.6.6.6, 1.2.3.4 "))) == "1.2.3.4",
          behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", ""))) == "10.0.0.1",
          behindProxy.client(Some("10.0.0.1"), Seq.empty) == "10.0.0.1",
          // without clientIpHeader the header is ignored - a client could fake it
          access.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "1.2.3.4"))) == "10.0.0.1",
          access.client(None, Seq.empty) == "unknown",
          // a CDN and a load balancer: the second entry from the end
          behindProxy.copy(trustedProxies = 2)
            .client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "6.6.6.6, 1.2.3.4, 10.0.0.9"))) == "1.2.3.4",
          // two lines (the proxy added its own) - the last entry of all of them
          behindProxy.client(
            Some("10.0.0.1"),
            Seq(Header("X-Forwarded-For", "6.6.6.6"), Header("X-Forwarded-For", "1.2.3.4"))
          ) == "1.2.3.4",
          // no address - the remote address
          behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "x" * 200))) == "10.0.0.1",
          // IPv6 by its /64 - rotating within it gives no new limit
          behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "2001:db8::1"))) == "2001:db8:0:0::/64",
          behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "2001:DB8:0:0:ffff::7"))) == "2001:db8:0:0::/64",
          access.client(Some("fe80::1%eth0"), Seq.empty) == "fe80:0:0:0::/64",
          access.client(Some("::ffff:1.2.3.4"), Seq.empty) == "1.2.3.4",
          // with a port (some proxies add it)
          behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "1.2.3.4:5678"))) == "1.2.3.4",
          behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "[2001:db8::1]:5678"))) == "2001:db8:0:0::/64",
          // no IP literal in the header - the remote address
          List("::.", "a:.", "1.2.3", "300.1.1.1", "1:2:3", "::ffff:x.y", "1:2:3:4:5:6:7:8:9", "1:2:3:4::5:6:7:8")
            .forall: junk =>
            behindProxy.client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", junk))) == "10.0.0.1"
          ,
          // fewer entries than proxies - the remote address
          behindProxy.copy(trustedProxies = 2)
            .client(Some("10.0.0.1"), Seq(Header("X-Forwarded-For", "1.2.3.4"))) == "10.0.0.1"
        )
      ,
      test("the business key: optional or required, short and plain"):
        val g = guard(TestClock())
        assertTrue(
          g.businessKey(None, required = false) == Right(None),
          g.businessKey(Some(" "), required = false) == Right(None),
          g.businessKey(None, required = true).left.map(_.errorCode) == Left(400),
          g.businessKey(Some("anna.berater-2026-10-08T09:00"), required = true) == Right(Some("anna.berater-2026-10-08T09:00")),
          g.businessKey(Some("a b"), required = true).left.map(_.errorCode) == Left(400),
          g.businessKey(Some("x" * 129), required = true).left.map(_.errorCode) == Left(400),
          // for a public message: at least 16
          g.businessKey(Some("1"), required = true, minLength = 16).left.map(_.errorCode) == Left(400),
          g.businessKey(Some("0b1c9a4e-7a43-4f0e-9d39-3a3f6c2d8e11"), required = true, minLength = 16).isRight
        )
      ,
      test("a text from a caller as one log line"):
        assertTrue(
          PublicAccess.oneLine("bad\nINFO forged\r\tline") == "bad INFO forged  line",
          PublicAccess.oneLine("x" * 400).length == 300,
          PublicAccess.oneLine(null) == ""
        )
      ,
      test("values that would refuse every call - refused at once"):
        assertTrue(
          scala.util.Try(access.copy(trustedProxies = 0)).isFailure,
          scala.util.Try(access.copy(requestsPerMinute = 0)).isFailure,
          scala.util.Try(access.copy(maxConcurrentCalls = 0)).isFailure,
          scala.util.Try(access.copy(maxBodyBytes = 0)).isFailure,
          scala.util.Try(access.copy(callTimeout = Duration.Zero)).isFailure
        )
      ,
      test("a name from a caller goes into the log cleaned and short"):
        assertTrue(
          PublicAccess.loggable("acme-shop-freeSlots") == "acme-shop-freeSlots",
          PublicAccess.loggable("x\nINFO forged line") == "x?INFO?forged?line",
          PublicAccess.loggable("x" * 200).length == 80
        )
      ,
      test("the secret of the login is never shown"):
        val withLogin = access.copy(login = Some(login))
        assertTrue(!withLogin.toString.contains("the-client-secret"), !login.toString.contains("the-client-secret"))
    ),
    suite("PublicToken")(
      test("kept until shortly before it expires - at most 30 seconds, at most half its time, at least 5"):
        val clock = TestClock()
        for
          long     <- fakeToken(clock, Right("""{"access_token":"t1","expires_in":300}"""))
          short    <- fakeToken(clock, Right("""{"access_token":"t2","expires_in":20}"""))
          zero     <- fakeToken(clock, Right("""{"access_token":"t3","expires_in":0}"""))
          tiny     <- fakeToken(clock, Right("""{"access_token":"t4","expires_in":2}"""))
          _        <- long.token *> short.token *> zero.token *> tiny.token
          _        <- ZIO.succeed(clock.set(4 * 1000L))
          _        <- zero.token *> tiny.token  // zero: kept 5 seconds; tiny: not longer than its 2
          _        <- ZIO.succeed(clock.set(9 * 1000L))
          _        <- long.token *> short.token // short: still within 20 - 10 seconds
          _        <- ZIO.succeed(clock.set(11 * 1000L))
          _        <- long.token *> short.token // short: renewed
          _        <- ZIO.succeed(clock.set(271 * 1000L))
          _        <- long.token                // long: renewed after 300 - 30 seconds
          longReq  <- long.requests.get
          shortReq <- short.requests.get
          zeroReq  <- zero.requests.get
          tinyReq  <- tiny.requests.get
        yield assertTrue(longReq == 2, shortReq == 2, zeroReq == 1, tinyReq == 2)
      ,
      test("expires_in missing or strange: 60 seconds; as a string or a decimal: read"):
        def requests(answer: String) =
          val clock = TestClock()
          for
            t     <- fakeToken(clock, Right(answer))
            token <- t.token
            _     <- ZIO.succeed(clock.set(29 * 1000L)) *> t.token
            _     <- ZIO.succeed(clock.set(31 * 1000L)) *> t.token
            req   <- t.requests.get
          yield token -> req
        for
          missing <- requests("""{"access_token":"t1"}""")
          strange <- requests("""{"access_token":"t1","expires_in":"soon"}""")
          string  <- requests("""{"access_token":"t1","expires_in":"300"}""")
          decimal <- requests("""{"access_token":"t1","expires_in":300.0}""")
          huge    <- requests("""{"access_token":"t1","expires_in":9000000000000000}""")
        yield assertTrue(
          missing == ("t1" -> 2),
          strange == ("t1" -> 2),
          string == ("t1" -> 1),
          decimal == ("t1" -> 1),
          huge == ("t1" -> 1) // capped at a day - no overflow to "expired"
        )
      ,
      test("a clock below 0 (the monotonic one can be) - logs in all the same"):
        val clock = TestClock()
        clock.set(-1_000_000L)
        for
          t     <- fakeToken(clock, Right("""{"access_token":"t1","expires_in":300}"""))
          token <- t.token.either
        yield assertTrue(token == Right("t1"))
      ,
      test("many calls at once - one fetch"):
        for
          t      <- fakeToken(TestClock(), Right("""{"access_token":"t1","expires_in":300}"""))
          tokens <- ZIO.foreachPar(1 to 20)(_ => t.token)
          req    <- t.requests.get
        yield assertTrue(tokens.forall(_ == "t1"), req == 1)
      ,
      test("invalidated - the next call fetches a new one; not a younger one, not another token"):
        val clock = TestClock()
        for
          t      <- fakeToken(clock, Right("""{"access_token":"t1","expires_in":300}"""))
          _      <- t.token
          young  <- ZIO.succeed(t.invalidate("t1")) <* t.token           // younger than 10 seconds - kept
          _      <- ZIO.succeed(clock.set(11 * 1000L))
          other  <- ZIO.succeed(t.invalidate("an-older-one")) <* t.token // another token - kept
          before <- t.requests.get
          old    <- ZIO.succeed(t.invalidate("t1")) <* t.token
          after  <- t.requests.get
        yield assertTrue(!young, !other, old, before == 1, after == 2)
      ,
      test("a failed login - a generic 503, and no new try for a few seconds"):
        val clock = TestClock()
        for
          t      <- fakeToken(clock, Left("connection refused: http://sso.internal:8080"))
          bad    <- fakeToken(clock, Right("<html>oops</html>"))
          first  <- t.token.either
          second <- t.token.either
          _      <- ZIO.succeed(clock.set(6 * 1000L))
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
      test("no answer within callTimeout - a 503"):
        for
          token    <- techTokenOf(TestClock())
          got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          slow      = access.copy(login = Some(login), callTimeout = 1.second) // room for a slow CI machine
          r         = routes(slow, got, ZIO.never, Some(token))
          response <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}")
        yield assertTrue(response.status == Status.ServiceUnavailable)
      @@ TestAspect.withLiveClock,
      test("more than maxConcurrentCalls at once - a 503 at once"):
        for
          token    <- techTokenOf(TestClock())
          got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          release  <- Promise.make[Nothing, Unit]
          one       = access.copy(login = Some(login), maxConcurrentCalls = 1)
          r         = routes(one, got, release.await, Some(token))
          first    <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}").fork
          _        <- got.get.repeatUntil(_.nonEmpty) // the first one is in the engine
          second   <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdeg", "{}")
          _        <- release.succeed(())
          done     <- first.join
        yield assertTrue(second.status == Status.ServiceUnavailable, done.status == Status.Ok)
      @@ TestAspect.withLiveClock,
      test("a call that takes too long - interrupted; its slot is free once it has stopped"):
        def calls(slow: UIO[Unit]) =
          for
            token    <- techTokenOf(TestClock())
            got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
            n        <- Ref.make(0)
            answer    = n.getAndUpdate(_ + 1).flatMap(i => if i == 0 then slow else ZIO.unit)
            one       = access.copy(login = Some(login), maxConcurrentCalls = 1, callTimeout = 1.second) // room for a slow CI machine
            r         = routes(one, got, answer, Some(token))
            first    <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}")
            second   <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdeg", "{}")
          yield first.status.code -> second.status.code
        for
          interrupted <- Promise.make[Nothing, Unit]
          // interruptible - stopped at the timeout, the next call gets the slot
          stopped     <- calls(ZIO.never.onInterrupt(interrupted.succeed(())))
          wasStopped  <- interrupted.isDone.repeatUntil(identity).timeout(1.second)
          // not interruptible - still running, the next call finds no slot
          busy        <- calls(ZIO.sleep(4.seconds).uninterruptible)
        yield assertTrue(stopped == (503 -> 200), wasStopped.contains(true), busy == (503 -> 503))
      @@ TestAspect.withLiveClock,
      test("the caller is gone - the call still stops at its timeout and frees its slot"):
        for
          token  <- techTokenOf(TestClock())
          got    <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          n      <- Ref.make(0)
          answer  = n.getAndUpdate(_ + 1).flatMap(i => if i == 0 then ZIO.never else ZIO.unit)
          one     = access.copy(login = Some(login), maxConcurrentCalls = 1, callTimeout = 1.second) // room for a slow CI machine
          r       = routes(one, got, answer, Some(token))
          first  <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}").fork
          _      <- got.get.repeatUntil(_.nonEmpty) // the first one is in the engine
          _      <- first.interrupt                 // the caller is gone
          _      <- ZIO.sleep(1500.millis)
          second <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdeg", "{}")
        yield assertTrue(second.status == Status.Ok)
      @@ TestAspect.withLiveClock,
      test("the client through the route: counted per clientIpHeader entry - or all as one without it"):
        def fourth(publicAccess: PublicAccess) =
          for
            got   <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
            r      = routes(publicAccess, got)
            _     <- ZIO.foreach(1 to 3)(_ => post(r, "/public/worker/acme-shop-unknown", "{}", "X-Forwarded-For" -> "1.1.1.1"))
            same  <- post(r, "/public/worker/acme-shop-unknown", "{}", "X-Forwarded-For" -> "1.1.1.1")
            other <- post(r, "/public/worker/acme-shop-unknown", "{}", "X-Forwarded-For" -> "2.2.2.2")
          yield same.status.code -> other.status.code
        for
          behindProxy <- fourth(access.copy(clientIpHeader = Some("X-Forwarded-For")))
          ignored     <- fourth(access)
        yield assertTrue(behindProxy == (429 -> 404), ignored == (429 -> 429))
      ,
      test("a business key that is not plain or short - 400"):
        for
          notPlain <- post(access, "/public/process/acme-shop-bookV1/async?businessKey=a%20b", "{}")
          short    <- post(access, "/public/process/acme-shop-bookV1/async?businessKey=r-1", "{}")
        yield assertTrue(notPlain.status == Status.BadRequest, short.status == Status.BadRequest)
      ,
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
      test("too large or broken bodies - 413 / 400, and they count: then 429"):
        val big = s"""{"text":"${"x" * 200}"}"""
        for
          got    <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          r       = routes(access, got)
          large  <- post(r, "/public/process/acme-shop-bookV1/async", big)
          broken <- post(r, "/public/process/acme-shop-bookV1/async", "{not json")
          _      <- post(r, "/public/process/acme-shop-bookV1/async", "{not json")
          fourth <- post(r, "/public/process/acme-shop-bookV1/async", "{}")
        yield assertTrue(
          large.status == Status.RequestEntityTooLarge,
          broken.status == Status.BadRequest,
          fourth.status == Status.TooManyRequests
        )
      ,
      test("listed, but the gateway has no login - a generic 503, not a call without token"):
        for
          response <- post(access, "/public/worker/acme-shop-freeSlots", "{}")
          body     <- response.body.asString
        yield assertTrue(response.status == Status.ServiceUnavailable, !body.contains("login"))
      ,
      test("a worker - called with the technical token, without the honeypot field"):
        val clock = TestClock()
        for
          token    <- techTokenOf(clock)
          got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          r         = routes(access.copy(login = Some(login)), got, token = Some(token))
          response <- post(r, "/public/worker/acme-shop-freeSlots", """{"topic":"x","_hp":""}""")
          body     <- response.body.asString
        yield assertTrue(response.status == Status.Ok, json(body) == json("""{"topic":"x"}"""))
      ,
      test("a process start - with the technical token and the checked body"):
        val clock = TestClock()
        for
          token    <- techTokenOf(clock)
          got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          r         = routes(access.copy(login = Some(login)), got, token = Some(token))
          response <- post(r, "/public/process/acme-shop-bookV1/async?businessKey=r-0123456789abcdef", """{"ok":true,"_hp":""}""")
          sent     <- got.get
        yield assertTrue(
          response.status == Status.Ok,
          sent.flatMap(_._1) == Some(techToken),
          sent.flatMap(_._2).flatMap(_("ok")) == Some(Json.True),
          sent.flatMap(_._2).exists(!_.contains("_hp"))
        )
      ,
      test("a message - with the technical token, without the honeypot field"):
        val clock = TestClock()
        for
          token    <- techTokenOf(clock)
          got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
          r         = routes(access.copy(login = Some(login)), got, token = Some(token))
          response <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", """{"ok":true,"_hp":""}""")
          sent     <- got.get
        yield assertTrue(response.status == Status.Ok, sent == Some(Some(techToken) -> json("""{"ok":true}""").asObject))
      ,
      test("what the engine answers - without its detail: 4xx keeps its status, 5xx and defects are a 503"):
        def answer(code: Int) =
          for
            token    <- techTokenOf(TestClock())
            got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
            fail      = ZIO.fail(EngineError.ServiceRequestError(code, "definition x not found at http://engine.internal"))
            r         = routes(access.copy(login = Some(login)), got, fail, Some(token))
            response <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}")
            body     <- response.body.asString
          yield response.status.code -> body
        def defect =
          for
            token    <- techTokenOf(TestClock())
            got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
            r         = routes(access.copy(login = Some(login)), got, ZIO.die(RuntimeException("boom at http://engine.internal")), Some(token))
            response <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}")
            body     <- response.body.asString
          yield response.status.code -> body
        for
          notFound <- answer(404)
          failed   <- answer(500)
          died     <- defect
        yield assertTrue(
          notFound._1 == 400, // a message: always 400 - no hint whether the key exists
          failed._1 == 503,
          died._1 == 503,
          !died._2.contains("engine.internal"),
          !notFound._2.contains("engine.internal"),
          !failed._2.contains("engine.internal")
        )
      ,
      test("the technical token rejected (401) - a 503, and a new one once it is old enough; 403 keeps it"):
        def calls(code: Int) =
          val clock = TestClock()
          for
            token    <- techTokenOf(clock)
            got      <- Ref.make(Option.empty[(Option[String], Option[JsonObject])])
            r         = routes(access.copy(login = Some(login)), got, ZIO.fail(EngineError.ServiceRequestError(code, "no")), Some(token))
            first    <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}")
            _        <- ZIO.succeed(clock.set(11 * 1000L))
            _        <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}")
            _        <- post(r, "/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef", "{}")
            requests <- token.requests.get
          yield first.status.code -> requests
        for
          rejected  <- calls(401)
          forbidden <- calls(403)
        yield assertTrue(rejected == (503 -> 2), forbidden == (400 -> 1)) // a message: 400, the token kept
    )
  )
end PublicAccessSpec
