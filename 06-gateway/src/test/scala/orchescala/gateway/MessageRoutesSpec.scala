package orchescala.gateway

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import orchescala.domain.IdentityCorrelation
import orchescala.engine.DefaultEngineConfig
import orchescala.engine.domain.{EngineError, EngineType, MessageCorrelationResult}
import orchescala.engine.services.MessageService
import orchescala.worker.DefaultWorkerConfig
import zio.*
import zio.test.*

/** The gateway passes the sender's identity to the engine only for a message to a named process
  * instance - the engine signs it for that instance.
  */
object MessageRoutesSpec extends ZIOSpecDefault:

  private given GatewayConfig = DefaultGatewayConfig(
    engineConfig = DefaultEngineConfig(),
    workerConfig = DefaultWorkerConfig(DefaultEngineConfig())
  )

  private val token =
    JWT.create().withClaim("preferred_username", "bob").sign(Algorithm.HMAC256("test-secret"))

  /** Records the identity each message got. */
  private class FakeMessages(got: Ref[Seq[Option[IdentityCorrelation]]]) extends MessageService:
    def engineType: EngineType = EngineType.C8
    def sendMessage(
        name: String,
        tenantId: Option[String],
        timeToLiveInSec: Option[Int],
        businessKey: Option[String],
        processInstanceId: Option[String],
        variables: Option[io.circe.JsonObject],
        identityCorrelation: Option[IdentityCorrelation]
    ): IO[EngineError, MessageCorrelationResult] =
      got.update(_ :+ identityCorrelation)
        .as(MessageCorrelationResult.ProcessInstance("4711", "4711", EngineType.C8))

  def spec = suite("MessageRoutes")(
    test("the sender's identity only with a processInstanceId; a token without claims still sends") {
      for
        got    <- Ref.make(Seq.empty[Option[IdentityCorrelation]])
        routes  = MessageRoutes(FakeMessages(got))
        _      <- routes.send(token, "reset", None, None, None, Some("4711"), None)
        _      <- routes.send(token, "reset", None, None, Some("bk-1"), None, None)
        _      <- routes.send("not-a-jwt", "reset", None, None, None, Some("4711"), None)
        actors <- got.get
      yield assertTrue(
        actors.map(_.map(_.username)) == Seq(Some("bob"), None, None)
      )
    }
  )
end MessageRoutesSpec
