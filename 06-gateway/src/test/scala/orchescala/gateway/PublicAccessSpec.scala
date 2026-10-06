package orchescala.gateway

import io.circe.parser.parse
import orchescala.domain.*
import orchescala.engine.DefaultEngineConfig
import orchescala.gateway.PublicAccess.Kind
import orchescala.worker.DefaultWorkerConfig
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

  private def guard(at: Ref[Long]) = Unsafe.unsafe(implicit u => PublicGuard(access, () => Runtime.default.unsafe.run(at.get).getOrThrow()))

  /** The public routes (the engine services are not reached by these calls). */
  private def routes(publicAccess: PublicAccess) =
    given GatewayConfig = DefaultGatewayConfig(
      engineConfig = DefaultEngineConfig(),
      workerConfig = DefaultWorkerConfig(DefaultEngineConfig()),
      publicAccess = publicAccess
    )
    ZioHttpInterpreter(ZioHttpServerOptions.default)
      .toHttp(PublicRoutes(ProcessInstanceRoutes(null, null), MessageRoutes(null)).routes)

  private def post(publicAccess: PublicAccess, path: String, body: String) =
    ZIO.scoped(routes(publicAccess).runZIO(Request.post(URL.decode(path).toOption.get, Body.fromString(body))))

  def spec: Spec[TestEnvironment & Scope, Any] = suite("PublicAccess")(
    suite("PublicGuard")(
      test("only what is listed - per kind"):
        for at <- Ref.make(0L)
        yield
          val g = guard(at)
          assertTrue(
            g.check(Kind.worker, "acme-shop-freeSlots", "a", json("{}")).isRight,
            g.check(Kind.worker, "acme-shop-other", "b", json("{}")).left.map(_.errorCode) == Left(404),
            // a process key is no worker topic
            g.check(Kind.worker, "acme-shop-bookV1", "c", json("{}")).left.map(_.errorCode) == Left(404),
            g.check(Kind.processStart, "acme-shop-bookV1", "d", json("{}")).isRight,
            g.check(Kind.message, "acme-shop-bookV1-verified", "e", json("{}")).isRight
          )
      ,
      test("the honeypot: filled in - refused; empty - removed before the call"):
        for at <- Ref.make(0L)
        yield
          val g = guard(at)
          assertTrue(
            g.check(Kind.worker, "acme-shop-freeSlots", "a", json("""{"topic":"x","_hp":"I am a bot"}"""))
              .left.map(_.errorCode) == Left(400),
            g.check(Kind.worker, "acme-shop-freeSlots", "b", json("""{"topic":"x","_hp":""}""")) == Right(json("""{"topic":"x"}""")),
            g.check(Kind.worker, "acme-shop-freeSlots", "c", json("""{"topic":"x","_hp":null}""")) == Right(json("""{"topic":"x"}"""))
          )
      ,
      test("a body that is too large - 413"):
        for at <- Ref.make(0L)
        yield
          val big = s"""{"text":"${"x" * 200}"}"""
          assertTrue(guard(at).check(Kind.worker, "acme-shop-freeSlots", "a", json(big)).left.map(_.errorCode) == Left(413))
      ,
      test("the rate limit per client and minute - unknown names count as well"):
        for
          at     <- Ref.make(0L)
          g       = guard(at)
          first  <- ZIO.succeed((1 to 3).map(_ => g.check(Kind.worker, "acme-shop-unknown", "a", json("{}")).left.map(_.errorCode)))
          fourth  = g.check(Kind.worker, "acme-shop-freeSlots", "a", json("{}")).left.map(_.errorCode)
          other   = g.check(Kind.worker, "acme-shop-freeSlots", "b", json("{}")).isRight
          _      <- at.set(61 * 1000L)
          later   = g.check(Kind.worker, "acme-shop-freeSlots", "a", json("{}")).isRight
        yield assertTrue(first.forall(_ == Left(404)), fourth == Left(429), other, later)
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
      test("a public message needs the business key"):
        for response <- post(access, "/public/message/acme-shop-bookV1-verified", "{}")
        yield assertTrue(response.status == Status.BadRequest)
      ,
      test("listed, but the gateway has no login - 503, not a call without token"):
        for
          response <- post(access, "/public/worker/acme-shop-freeSlots", "{}")
          body     <- response.body.asString
        yield assertTrue(response.status == Status.ServiceUnavailable, body.contains("PublicAccess.login"))
    )
  )
end PublicAccessSpec
