package orchescala.worker.c7

import com.sun.net.httpserver.HttpServer
import munit.FunSuite
import org.apache.hc.client5.http.classic.methods.HttpGet
import org.apache.hc.client5.http.config.{ConnectionConfig, RequestConfig}
import org.apache.hc.client5.http.impl.classic.HttpClients
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder
import org.apache.hc.core5.pool.{PoolConcurrencyPolicy, PoolReusePolicy}
import org.apache.hc.core5.util.Timeout

import java.net.InetSocketAddress
import java.util.concurrent.{CountDownLatch, Executors, TimeUnit}
import java.util.concurrent.atomic.AtomicInteger
import scala.util.Try

/**
 * Regression test for the connection pool exhaustion bug that caused the C7 worker
 * to stop fetching tasks with:
 *   org.apache.hc.core5.http.ConnectionRequestTimeoutException:
 *     Timeout deadline: 180000 MILLISECONDS, actual: 180000 MILLISECONDS
 *
 * Root cause: a single ExternalTaskClient needs 1 connection for the long-polling
 * fetchAndLock call plus up to `maxTasks` concurrent connections for complete/handleFailure
 * calls on the SAME route. If `maxConnPerRoute` is not comfortably larger than
 * `maxTasks + 1`, the pool saturates under load and new requests block until
 * connectionRequestTimeout elapses.
 *
 * This test reproduces that behavior against a local slow HTTP server (no real Camunda
 * needed) and proves:
 *   - an undersized pool (mirroring the old maxConnPerRoute=10 with maxTasks=10) throws
 *     ConnectionRequestTimeoutException under concurrent load
 *   - a correctly sized pool (mirroring the fixed maxConnPerRoute=30) does not
 */
class SharedHttpClientManagerPoolSizingTest extends FunSuite:

  private def withSlowServer(delayMillis: Long)(testCode: Int => Unit): Unit =
    val server = HttpServer.create(new InetSocketAddress("localhost", 0), 0)
    server.createContext(
      "/",
      exchange =>
        Thread.sleep(delayMillis)
        val response = "ok".getBytes
        exchange.sendResponseHeaders(200, response.length.toLong)
        exchange.getResponseBody.write(response)
        exchange.getResponseBody.close()
    )
    server.setExecutor(Executors.newCachedThreadPool())
    server.start()
    try testCode(server.getAddress.getPort)
    finally server.stop(0)

  /** Fires `concurrentRequests` GET requests in parallel against the given port,
    * using a connection manager sized with `maxConnPerRoute`, and returns the number
    * of requests that failed with ConnectionRequestTimeoutException.
    */
  private def countPoolTimeouts(
      port: Int,
      maxConnPerRoute: Int,
      concurrentRequests: Int
  ): Int =
    val connectionConfig = ConnectionConfig.custom()
      .setConnectTimeout(Timeout.ofSeconds(5))
      .setSocketTimeout(Timeout.ofSeconds(5))
      .build()

    val connectionManager = PoolingHttpClientConnectionManagerBuilder.create()
      .setDefaultConnectionConfig(connectionConfig)
      .setMaxConnPerRoute(maxConnPerRoute)
      .setMaxConnTotal(maxConnPerRoute * 2)
      .setPoolConcurrencyPolicy(PoolConcurrencyPolicy.STRICT)
      .setConnPoolPolicy(PoolReusePolicy.FIFO)
      .build()

    val requestConfig = RequestConfig.custom()
      // short, deterministic timeout for the test instead of the real 3-minute default
      .setConnectionRequestTimeout(Timeout.ofMilliseconds(500))
      .build()

    val httpClient = HttpClients.custom()
      .setConnectionManager(connectionManager)
      .setDefaultRequestConfig(requestConfig)
      .build()

    try
      val timeoutCount = new AtomicInteger(0)
      val latch        = new CountDownLatch(concurrentRequests)
      val pool         = Executors.newFixedThreadPool(concurrentRequests)
      try
        (1 to concurrentRequests).foreach { _ =>
          pool.submit(new Runnable:
            def run(): Unit =
              try
                httpClient.execute(new HttpGet(s"http://localhost:$port/"), _ => null)
              catch
                case _: org.apache.hc.core5.http.ConnectionRequestTimeoutException =>
                  timeoutCount.incrementAndGet()
              finally latch.countDown()
          )
        }
        latch.await(30, TimeUnit.SECONDS)
        timeoutCount.get()
      finally pool.shutdown()
    finally
      Try(httpClient.close())
      Try(connectionManager.close())

  test("undersized pool (maxConnPerRoute < concurrent demand) throws ConnectionRequestTimeoutException"):
    withSlowServer(delayMillis = 800) { port =>
      // mirrors the old bug: maxConnPerRoute=10 with maxTasks=10 -> 11 concurrent connections needed
      val timeouts = countPoolTimeouts(port, maxConnPerRoute = 5, concurrentRequests = 15)
      assert(timeouts > 0, "expected pool exhaustion to cause ConnectionRequestTimeoutException")
    }

  test("correctly sized pool (maxConnPerRoute comfortably exceeds concurrent demand) does not time out"):
    withSlowServer(delayMillis = 800) { port =>
      // mirrors the fix: maxConnPerRoute=30 comfortably exceeds maxTasks=10 + 1
      val timeouts = countPoolTimeouts(port, maxConnPerRoute = 30, concurrentRequests = 15)
      assertEquals(timeouts, 0)
    }

  test("actual SharedHttpClientManager.connectionManager survives maxTasks+1 concurrent load"):
    // This exercises the REAL production singleton (not a hand-rolled one), so it directly
    // reflects whatever maxConnPerRoute is currently configured in SharedHttpClientManager.scala.
    // With the old maxConnPerRoute=10, this fails for 11 concurrent connections
    // (1 fetchAndLock long-poll + maxTasks=10 concurrent complete/fail calls).
    withSlowServer(delayMillis = 2000) { port =>
      val requestConfig = RequestConfig.custom()
        .setConnectionRequestTimeout(Timeout.ofMilliseconds(200))
        .build()
      val httpClient    = HttpClients.custom()
        .setConnectionManager(SharedHttpClientManager.connectionManager)
        .setDefaultRequestConfig(requestConfig)
        .build()
      val maxTasks      = 10
      val concurrentDemand = maxTasks + 1 // +1 for the fetchAndLock long-poll connection

      try
        val timeoutCount = new AtomicInteger(0)
        val latch        = new CountDownLatch(concurrentDemand)
        val pool         = Executors.newFixedThreadPool(concurrentDemand)
        try
          (1 to concurrentDemand).foreach { _ =>
            pool.submit(new Runnable:
              def run(): Unit =
                try
                  httpClient.execute(new HttpGet(s"http://localhost:$port/"), _ => null)
                catch
                  case _: org.apache.hc.core5.http.ConnectionRequestTimeoutException =>
                    timeoutCount.incrementAndGet()
                finally latch.countDown()
            )
          }
          latch.await(30, TimeUnit.SECONDS)
          assertEquals(
            timeoutCount.get(),
            0,
            s"SharedHttpClientManager's connection pool is too small for maxTasks=$maxTasks " +
              "concurrent task completions plus the fetchAndLock long-poll connection"
          )
        finally pool.shutdown()
      finally Try(httpClient.close())
    }

end SharedHttpClientManagerPoolSizingTest
