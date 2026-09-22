package orchescala.engine.c8

import zio.*
import zio.test.*

object C8BearerTokenClientTest extends ZIOSpecDefault:

  // no network needed: the SDK only opens the gRPC channel / HTTP connection on the first call
  private def newClient(idleTtlMillis: Long): C8BearerTokenClient =
    new C8BearerTokenClient:
      protected def zeebeGrpc: String                       = "http://localhost:26500"
      protected def zeebeRest: String                       = "http://localhost:8080"
      override protected def tokenClientIdleTtlMillis: Long = idleTtlMillis

  def spec = suite("C8BearerTokenClient")(
    test("reuses one client per token instead of building one per request") {
      val c8Client = newClient(idleTtlMillis = 60_000)
      for
        first  <- c8Client.clientWithToken("token-a")
        second <- c8Client.clientWithToken("token-a")
        other  <- c8Client.clientWithToken("token-b")
        cached  = c8Client.cachedTokenClients
        _      <- ZIO.attempt(c8Client.closeTokenClients())
      yield assertTrue(
        first eq second,
        !(first eq other),
        cached == 2,
        c8Client.cachedTokenClients == 0
      )
    },
    test("evicts clients that were idle longer than the ttl") {
      val c8Client = newClient(idleTtlMillis = 0)
      for
        first  <- c8Client.clientWithToken("token-a")
        _      <- ZIO.sleep(5.millis).withClock(Clock.ClockLive)
        second <- c8Client.clientWithToken("token-b") // evicts token-a before adding token-b
        cached  = c8Client.cachedTokenClients
        _      <- ZIO.attempt(c8Client.closeTokenClients())
      yield assertTrue(!(first eq second), cached == 1)
    }
  )
end C8BearerTokenClientTest
