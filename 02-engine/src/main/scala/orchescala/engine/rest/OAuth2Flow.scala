package orchescala.engine.rest

import sttp.client3.*
import sttp.model.Uri

import java.util.concurrent.{Executors, TimeUnit, TimeoutException}
import scala.concurrent.duration.*

trait OAuth2Flow :
  protected def identityUrl: Uri

  // upper bound for one complete token call (connect + response + body);
  // the readTimeout below only covers until the response headers arrive,
  // so a token endpoint dying mid-body would otherwise block a thread forever
  protected def tokenCallHardTimeout: FiniteDuration = 30.seconds

  protected lazy val tokenRequest =
    basicRequest
      .post(identityUrl)
      .header("accept", "application/json")
      .header("content-type", "application/x-www-form-urlencoded")
      .readTimeout(10.seconds)  // prevent indefinite blocking when SSO is unreachable

  protected lazy val syncBackend: SttpBackend[Identity, Any] =
    HttpClientSyncBackend(options = SttpBackendOptions.connectionTimeout(10.seconds))

  /** Runs a blocking token call on a separate daemon thread with a hard overall timeout,
    * so the calling thread can never hang indefinitely on a half-dead identity provider.
    */
  protected def withHardTimeout[A](thunk: => A): Either[String, A] =
    try
      val future = OAuth2Flow.tokenCallExecutor.submit(() => thunk)
      try Right(future.get(tokenCallHardTimeout.toMillis, TimeUnit.MILLISECONDS))
      catch
        case _: TimeoutException                         =>
          future.cancel(true)
          Left(s"Token request to $identityUrl did not complete within $tokenCallHardTimeout.")
        case ex: java.util.concurrent.ExecutionException =>
          Left(s"Token request to $identityUrl failed: ${Option(ex.getCause).getOrElse(ex).getMessage}")
        case ex: InterruptedException                    =>
          Thread.currentThread().interrupt()
          Left(s"Token request to $identityUrl was interrupted.")
    catch
      case _: java.util.concurrent.RejectedExecutionException =>
        Left(s"Token request to $identityUrl rejected: all token-call threads are stuck " +
          "(identity provider not responding?)")
  end withHardTimeout

end OAuth2Flow

object OAuth2Flow:
  // daemon threads: a call stuck in a half-dead connection must not prevent JVM shutdown.
  // Bounded pool: calls that ignore interruption leave their thread stuck - an unbounded
  // pool would then grow with every timed-out call until the JVM runs out of threads.
  // If all threads are stuck, further submissions are rejected -> withHardTimeout fails fast.
  private lazy val tokenCallExecutor =
    val executor = new java.util.concurrent.ThreadPoolExecutor(
      0,
      16,
      60L,
      TimeUnit.SECONDS,
      new java.util.concurrent.SynchronousQueue[Runnable](),
      { (r: Runnable) =>
        val t = new Thread(r, "oauth2-token-call")
        t.setDaemon(true)
        t
      }
    )
    executor
end OAuth2Flow
