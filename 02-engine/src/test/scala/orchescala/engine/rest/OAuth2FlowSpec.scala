package orchescala.engine.rest

import sttp.model.Uri
import zio.*
import zio.test.*

object OAuth2FlowSpec extends ZIOSpecDefault:

  private object Flow extends OAuth2Flow:
    protected def identityUrl: Uri = Uri.unsafeParse("http://sso.test/token")
    def call[A](thunk: => A): Either[String, A] = withHardTimeout(thunk)

  def spec = suite("OAuth2Flow token calls")(
    test("more calls at once than threads wait - the 17th was rejected as if the IdP did not respond") {
      val calls = OAuth2Flow.maxThreads + 8
      for results <- ZIO.foreachPar(1 to calls)(i => ZIO.attemptBlocking(Flow.call { Thread.sleep(300); i }))
      yield assertTrue(results.forall(_.isRight), results.collect { case Right(i) => i }.sum == (1 to calls).sum)
    } @@ TestAspect.withLiveClock
  )
end OAuth2FlowSpec
