package orchescala.engine.gateway.http

import io.circe.parser.*
import orchescala.engine.c7.*
import orchescala.engine.domain.EngineError
import org.apache.hc.client5.http.entity.UrlEncodedFormEntity
import org.apache.hc.client5.http.impl.classic.HttpClients
import org.apache.hc.core5.http.io.support.ClassicRequestBuilder
import org.apache.hc.core5.http.message.BasicNameValuePair
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO

import scala.io.Source
import scala.jdk.CollectionConverters.*

/** Example showing the CORRECT way to implement CompanyEngineC7Client for pass-through authentication
  *
  * ## The Problem with the Old Implementation
  *
  * The old `CompanyEngineC7Client` had this code:
  *
  * ```scala
  * trait CompanyEngineC7Client extends C7Client:
  *   lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
  *     SharedC7ClientManager.getOrCreateClient:  // ❌ CACHES the client!
  *       for
  *         client <- ZIO.attempt(ApiClient())
  *         token  <- getOAuthTokenZIO()  // ❌ Token fetched once and cached
  *         _      <- ZIO.attempt:
  *                     client.addDefaultHeader("Authorization", s"Bearer $token")
  *       yield client
  * ```
  *
  * **Problems:**
  * 1. `SharedC7ClientManager.getOrCreateClient` caches the client
  * 2. The OAuth token is fetched once when the client is created
  * 3. When a new request comes with a fresh token, the cached client still has the old token
  * 4. Result: 401 errors until server restart
  *
  * ## The Solution: Use C7BearerTokenClient
  *
  * The new implementation extends `C7BearerTokenClient` instead:
  *
  * ```scala
  * trait CompanyEngineC7Client extends C7BearerTokenClient:
  *   override protected def camundaRestUrl: String = "http://localhost:8080/engine-rest"
  *   
  *   // That's it! The framework handles:
  *   // - Checking AuthContext for tokens on every request
  *   // - Creating fresh clients with tokens (no caching)
  *   // - Falling back to OAuth when no token in context
  * ```
  *
  * ## How It Works
  *
  * ### 1. Gateway receives request with Bearer token
  * ```bash
  * curl -X POST http://localhost:8888/process/my-process/async \
  *   -H "Authorization: Bearer eyJhbGc..." \
  *   -d '{"variables": {"test": true}}'
  * ```
  *
  * ### 2. GatewayRoutes extracts token and sets it in AuthContext
  * ```scala
  * GatewayEndpoints.startProcessAsync.zServerSecurityLogic { token =>
  *   validateToken(token)
  * }.serverLogic { validatedToken =>
  *   (processDefId, businessKeyQuery, request) =>
  *     // Set token in AuthContext for this request
  *     AuthContext.withBearerToken(validatedToken):
  *       processInstanceService.startProcessAsync(...)
  * }
  * ```
  *
  * ### 3. C7Client.resolveClient checks AuthContext on every request
  * ```scala
  * case bearerClient: C7BearerTokenClient =>
  *   ZIO.environmentWith[SharedC7ClientManager] { env =>
  *     AuthContext.get.flatMap { authContext =>
  *       authContext.bearerToken match
  *         case Some(token) =>
  *           // ✅ Create FRESH client with token from AuthContext
  *           bearerClient.clientWithToken(token)
  *         case None =>
  *           // ✅ No token in context, use default client (may fetch OAuth token)
  *           bearerClient.client.provideEnvironment(env)
  *     }
  *   }
  * ```
  *
  * ### 4. Result: Fresh token on every request!
  * - Request 1 with token A → creates client with token A
  * - Request 2 with token B → creates client with token B
  * - No caching, no stale tokens, no server restart needed!
  *
  * ## Migration Guide
  *
  * ### Before (OLD - with caching issue):
  * ```scala
  * trait CompanyEngineC7Client extends C7Client:
  *   lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
  *     SharedC7ClientManager.getOrCreateClient:  // ❌ Caches client
  *       for
  *         client <- ZIO.attempt(ApiClient())
  *         _      <- ZIO.attempt(client.setBasePath(camundaRestUrl))
  *         token  <- getOAuthTokenZIO()  // ❌ Token cached
  *         _      <- ZIO.attempt(client.addDefaultHeader("Authorization", s"Bearer $token"))
  *       yield client
  * ```
  *
  * ### After (NEW - with pass-through authentication):
  * ```scala
  * trait CompanyEngineC7Client extends C7BearerTokenClient:
  *   override protected def camundaRestUrl: String = "http://localhost:8080/engine-rest"
  *   
  *   // Optional: Override default client to use OAuth when no token in AuthContext
  *   override lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
  *     SharedC7ClientManager.getOrCreateClient:
  *       for
  *         client <- ZIO.attempt(ApiClient())
  *         _      <- ZIO.attempt(client.setBasePath(camundaRestUrl))
  *         token  <- getOAuthTokenZIO()  // Only used when no token in AuthContext
  *         _      <- ZIO.attempt(client.addDefaultHeader("Authorization", s"Bearer $token"))
  *       yield client
  * ```
  *
  * ## Key Changes
  *
  * 1. **Extend `C7BearerTokenClient` instead of `C7Client`**
  *    - This enables the framework to check AuthContext on every request
  *
  * 2. **Keep the OAuth logic in the `client` method**
  *    - This is used as a fallback when no token is in AuthContext
  *    - Useful for non-Gateway usage (e.g., simulations, workers)
  *
  * 3. **No other changes needed!**
  *    - The framework automatically handles pass-through authentication
  *    - Your existing OAuth logic still works for non-Gateway scenarios
  */
object CompanyEngineC7ClientExample:

  /** Example configuration (replace with your actual config) */
  object ExampleConfig:
    val camundaRestUrl = "http://localhost:8080/engine-rest"
    val fssoBaseUrl = "http://host.lima.internal:8090"
    val fssoRealm = "0949"
    val fssoClientName = "bpf"
    val fssoClientSecret = "your-secret"
    val fssoScope = "email fcs bpf profile"

  /** CORRECT implementation with C7BearerTokenClient for pass-through authentication */
  trait CompanyEngineC7ClientCorrect extends C7BearerTokenClient:
    
    override protected def camundaRestUrl: String = ExampleConfig.camundaRestUrl

    // Optional: Override default client to use OAuth when no token in AuthContext
    // This is used as a fallback for non-Gateway scenarios (simulations, workers, etc.)
    override lazy val client: ZIO[SharedC7ClientManager, EngineError, ApiClient] =
      SharedC7ClientManager.getOrCreateClient:
        (for
          _      <- ZIO.logDebug("Creating API Client with OAuth token (fallback)")
          client <- ZIO.attempt(ApiClient())
          _      <- ZIO.attempt(client.setBasePath(camundaRestUrl))
          token  <- getOAuthTokenZIO()
          _      <- ZIO.attempt(client.addDefaultHeader("Authorization", s"Bearer $token"))
        yield client)
          .mapError: ex =>
            EngineError.UnexpectedError(s"Problem creating API Client: $ex")

    // OAuth token fetching logic (same as before)
    private def getOAuthTokenZIO() =
      ZIO.attempt:
        val oauthClient = HttpClients.custom().build()
        val params = Map(
          "grant_type"    -> "client_credentials",
          "client_id"     -> ExampleConfig.fssoClientName,
          "client_secret" -> ExampleConfig.fssoClientSecret,
          "scope"         -> ExampleConfig.fssoScope
        )
        val tokenUrl = s"${ExampleConfig.fssoBaseUrl}/auth/realms/${ExampleConfig.fssoRealm}/protocol/openid-connect/token"
        getOAuthToken(oauthClient, tokenUrl, params)

    private def getOAuthToken(
        httpClient: org.apache.hc.client5.http.impl.classic.CloseableHttpClient,
        tokenUrl: String,
        params: Map[String, String]
    ): String =
      val formParams = params.map { case (key, value) =>
        new BasicNameValuePair(key, value)
      }.toList.asJava

      val request = ClassicRequestBuilder.post(tokenUrl)
        .setEntity(new UrlEncodedFormEntity(formParams))
        .build()

      val response = httpClient.execute(request)
      val entity   = response.getEntity
      val content  = Source.fromInputStream(entity.getContent).mkString

      val json = parse(content).getOrElse(throw new Exception("Failed to parse OAuth response"))
      val accessToken = json.hcursor.get[String]("access_token").getOrElse(
        throw new Exception("Failed to extract access token from OAuth response")
      )

      accessToken
    end getOAuthToken

  end CompanyEngineC7ClientCorrect

  /** Example usage in Gateway */
  object ExampleClient extends CompanyEngineC7ClientCorrect

  /** Summary of what happens:
    *
    * ## Scenario 1: Gateway with Bearer Token (Pass-Through)
    * 1. Client sends: `Authorization: Bearer token123`
    * 2. GatewayRoutes sets: `AuthContext.withBearerToken("token123")`
    * 3. C7Client.resolveClient checks AuthContext → finds token123
    * 4. Creates fresh client with token123 (NOT cached)
    * 5. Request succeeds with token123
    *
    * ## Scenario 2: Gateway with Different Token (No Restart Needed!)
    * 1. Client sends: `Authorization: Bearer token456`
    * 2. GatewayRoutes sets: `AuthContext.withBearerToken("token456")`
    * 3. C7Client.resolveClient checks AuthContext → finds token456
    * 4. Creates fresh client with token456 (NOT cached)
    * 5. Request succeeds with token456
    *
    * ## Scenario 3: Direct Usage (Simulation/Worker - No Gateway)
    * 1. No Bearer token in request (no Gateway)
    * 2. AuthContext has no token
    * 3. C7Client.resolveClient checks AuthContext → no token found
    * 4. Falls back to `client` method → fetches OAuth token
    * 5. Client is cached (OK because it's not per-request)
    * 6. Request succeeds with OAuth token
    */

end CompanyEngineC7ClientExample

