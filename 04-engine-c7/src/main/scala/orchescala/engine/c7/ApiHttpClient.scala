package orchescala.engine.c7

import org.apache.hc.client5.http.config.{ConnectionConfig, RequestConfig}
import org.apache.hc.client5.http.impl.classic.{CloseableHttpClient, HttpClients}
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder
import org.apache.hc.core5.util.{TimeValue, Timeout}

/** Apache HttpClient5 for the C7 / Op `ApiClient`s.
  *
  *   - Pool: `new ApiClient()` falls back to `HttpClients.createDefault()`, whose pool is capped at
  *     25 connections in total and 5 per route - every engine call goes to the same route, so at
  *     most 5 calls ran concurrently and the rest queued for a connection.
  *   - Timeouts: the `ApiClient` never applies its own `connectTimeout`, and HttpClient5 waits for a
  *     response without limit by default. An engine that accepts the connection but does not answer
  *     (GC pause, DB lock) blocked the calling thread forever.
  */
object ApiHttpClient:

  val maxConnTotal    = 200
  val maxConnPerRoute = 100

  /** establishing the TCP connection */
  val connectTimeout: Timeout           = Timeout.ofSeconds(10)
  /** waiting for the (next bytes of the) response - deployments included */
  val responseTimeout: Timeout          = Timeout.ofSeconds(60)
  /** waiting for a free connection of the pool */
  val connectionRequestTimeout: Timeout = Timeout.ofSeconds(30)

  /** A new client with its own pool - the caller owns it and must close it. */
  def pooled(responseTimeout: Timeout = responseTimeout): CloseableHttpClient =
    HttpClients.custom()
      .setConnectionManager(
        PoolingHttpClientConnectionManagerBuilder.create()
          .setMaxConnTotal(maxConnTotal)
          .setMaxConnPerRoute(maxConnPerRoute)
          .setDefaultConnectionConfig(
            ConnectionConfig.custom()
              .setConnectTimeout(connectTimeout)
              .setSocketTimeout(responseTimeout)
              .build()
          )
          .build()
      )
      .setDefaultRequestConfig(
        RequestConfig.custom()
          .setConnectionRequestTimeout(connectionRequestTimeout)
          .setResponseTimeout(responseTimeout)
          .build()
      )
      // the ApiClient keeps its own cookie store per request - nothing to share between calls
      .disableCookieManagement()
      .evictExpiredConnections()
      .evictIdleConnections(TimeValue.ofMinutes(1))
      .build()

end ApiHttpClient
