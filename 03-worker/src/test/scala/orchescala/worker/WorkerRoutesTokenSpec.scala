package orchescala.worker

import orchescala.engine.DefaultEngineConfig
import orchescala.engine.auth.TokenValidation
import zio.*
import zio.http.*
import zio.test.*

object WorkerRoutesTokenSpec extends ZIOSpecDefault:

  private def routes(tokenValidation: TokenValidation) =
    WorkerRoutes(
      DefaultEngineContext.example.copy(
        workerConfig = DefaultWorkerConfig(DefaultEngineConfig(), tokenValidation = tokenValidation)
      )
    ).routes(Set.empty)

  private def triggerWorker(token: String) =
    Request
      .post(URL.decode("/worker/unknown-topic").toOption.get, Body.fromString("{}"))
      .addHeader(Header.Authorization.Bearer(token))

  def spec = suite("/worker token validation")(
    test("TokenValidation.Jwt: an unverifiable token is answered with 401") {
      val jwt = TokenValidation.Jwt(
        "https://sso.example.com/auth/realms/test",
        jwksUrl = Some("http://unreachable.invalid/certs")
      )
      for response <- routes(jwt).runZIO(triggerWorker("just-a-string"))
      yield assertTrue(response.status == Status.Unauthorized)
    },
    test("PresenceOnly: the token passes, the request reaches the worker lookup") {
      for response <- routes(TokenValidation.PresenceOnly).runZIO(triggerWorker("just-a-string"))
      yield assertTrue(response.status == Status.NotFound) // no worker 'unknown-topic'
    }
  )
end WorkerRoutesTokenSpec
