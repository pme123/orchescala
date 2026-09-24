package orchescala.engine.c7

import com.fasterxml.jackson.databind.ObjectMapper
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient
import org.apache.hc.core5.io.CloseMode
import org.camunda.community.rest.client.invoker.ApiClient

/** Builds the `ApiClient` for a pass-through Bearer token (C7 and Op).
  *
  * `new ApiClient()` creates its own Apache HttpClient5 connection pool, so building one per
  * request leaked a pool on every gateway call. Here every token client runs on ONE shared
  * HttpClient (and one shared, thread-safe ObjectMapper): the `ApiClient` itself only holds the
  * base path and the `Authorization` header, is cheap to build per request and needs no closing.
  * No per-token state is kept, so neither the number of tokens nor their rotation grows memory.
  */
object BearerTokenApiClient:

  // one pool for all gateway requests - cookies are disabled (see ApiHttpClient), so nothing
  // (e.g. a session) is carried from one user to another
  private lazy val sharedHttpClient: CloseableHttpClient =
    val client = ApiHttpClient.pooled()
    java.lang.Runtime.getRuntime.addShutdownHook(new Thread(() => client.close(CloseMode.GRACEFUL)))
    client

  // configured by the ApiClient constructor - taken from there so it stays identical to the SDK's
  private lazy val sharedObjectMapper: ObjectMapper =
    new ApiClient(sharedHttpClient).getObjectMapper

  /** A client for `basePath` that sends `token` as Bearer token, on the shared connection pool. */
  def apply(basePath: String, token: String): ApiClient =
    val apiClient = new ApiClient(sharedHttpClient)
    apiClient.setObjectMapper(sharedObjectMapper)
    apiClient.setBasePath(basePath)
    apiClient.addDefaultHeader("Authorization", s"Bearer $token")
    apiClient
  end apply

end BearerTokenApiClient
