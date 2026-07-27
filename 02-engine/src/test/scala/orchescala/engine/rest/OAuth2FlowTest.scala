package orchescala.engine.rest

import munit.FunSuite
import sttp.model.Uri
import sttp.client3.UriContext

import scala.concurrent.duration.*

/**
 * Regression tests for the worker freeze after a Keycloak restart:
 * a token call must never block a thread indefinitely (the java.net.http readTimeout
 * only covers until the response headers arrive, not the body), and cached tokens
 * must expire according to their actual lifetime.
 */
class OAuth2FlowTest extends FunSuite:

  private class TestFlow(hardTimeout: FiniteDuration) extends OAuth2Flow:
    protected def identityUrl: Uri                          = uri"http://localhost:9/token"
    override protected def tokenCallHardTimeout: FiniteDuration = hardTimeout
    def run[A](thunk: => A): Either[String, A]              = withHardTimeout(thunk)

  test("withHardTimeout returns the result of a fast call"):
    val flow = TestFlow(1.second)
    assertEquals(flow.run("token"), Right("token"))

  test("withHardTimeout aborts a call that hangs longer than the hard timeout"):
    val flow   = TestFlow(200.millis)
    val result = flow.run {
      Thread.sleep(5000)
      "never"
    }
    assert(result.isLeft, s"expected Left, got $result")
    assert(result.swap.exists(_.contains("did not complete within")), s"unexpected message: $result")

  test("withHardTimeout turns exceptions of the call into a Left"):
    val flow   = TestFlow(1.second)
    val result = flow.run(throw new RuntimeException("connection refused"))
    assert(result.swap.exists(_.contains("connection refused")), s"unexpected: $result")

  test("TokenCache.ttlFor uses expires_in minus safety margin"):
    assertEquals(TokenCache.ttlFor(Some(300L)), 270.seconds)

  test("TokenCache.ttlFor uses half the lifetime for short-lived tokens"):
    assertEquals(TokenCache.ttlFor(Some(10L)), 5.seconds)

  test("TokenCache.ttlFor never caches beyond the actual token lifetime"):
    for expiresIn <- List(1L, 10L, 29L, 30L, 60L, 300L, 3600L) do
      val ttl = TokenCache.ttlFor(Some(expiresIn))
      assert(ttl <= expiresIn.seconds, s"ttl $ttl exceeds lifetime ${expiresIn}s")
      assert(ttl > Duration.Zero, s"ttl must be positive for expires_in=${expiresIn}s")

  test("TokenCache.ttlFor is never negative"):
    assertEquals(TokenCache.ttlFor(Some(0L)), Duration.Zero)

  test("TokenCache.ttlFor falls back to the default ttl without expires_in"):
    assertEquals(TokenCache.ttlFor(None), 4.minutes)

end OAuth2FlowTest
