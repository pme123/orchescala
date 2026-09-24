package orchescala.engine.c7

import org.apache.hc.client5.http.impl.classic.{CloseableHttpClient, HttpClients}
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder
import org.apache.hc.core5.util.TimeValue

/** Apache HttpClient5 for the C7 / Op `ApiClient`s.
  *
  * `new ApiClient()` falls back to `HttpClients.createDefault()`, whose pool is capped at 25
  * connections in total and 5 per route - every engine call goes to the same route, so at most 5
  * calls ran concurrently and the rest queued for a connection.
  */
object ApiHttpClient:

  val maxConnTotal    = 200
  val maxConnPerRoute = 100

  /** A new client with its own pool - the caller owns it and must close it. */
  def pooled(): CloseableHttpClient =
    HttpClients.custom()
      .setConnectionManager(
        PoolingHttpClientConnectionManagerBuilder.create()
          .setMaxConnTotal(maxConnTotal)
          .setMaxConnPerRoute(maxConnPerRoute)
          .build()
      )
      // the ApiClient keeps its own cookie store per request - nothing to share between calls
      .disableCookieManagement()
      .evictExpiredConnections()
      .evictIdleConnections(TimeValue.ofMinutes(1))
      .build()

end ApiHttpClient
