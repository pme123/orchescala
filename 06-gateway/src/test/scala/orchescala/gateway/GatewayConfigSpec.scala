package orchescala.gateway

import zio.*
import zio.test.*
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import java.util.Base64
import scala.jdk.CollectionConverters.*

object GatewayConfigSpec extends ZIOSpecDefault:
  private lazy val config = GatewayConfig()

  def spec = suite("GatewayConfig")(
    suite("defaultTokenValidator")(
      test("should succeed with non-empty token") {
        val token = "valid-token"
        for
          result <- GatewayConfig.defaultTokenValidator(token)
        yield assertTrue(result == token)
      },
      test("should fail with empty token") {
        for
          result <- GatewayConfig.defaultTokenValidator("").exit
        yield assertTrue(result.isFailure)
      }
    ),
    suite("extractCorrelation")(
      test("should extract payload from valid JWT") {
        val payload = Map("preferred_username" -> "user123", "email" -> "pme@master.ch").asJava
        val token   = JWT.create()
          .withPayload(payload)
          .sign(Algorithm.none())

        for
          result <- config.extractCorrelation(token)
        yield assertTrue(
          result.username == "user123",
          result.email.contains("pme@master.ch"),
          result.secret == "",
          result.impersonateProcessValue.isEmpty
        )
      },
      test("should fail with invalid JWT") {
        for
          result <- config.extractCorrelation("invalid-token").exit
        yield assertTrue(result.isFailure)
      }
    )
  )
end GatewayConfigSpec
