package orchescala.worker

import zio.test.*

object PendingIdentityRetriesSpec extends ZIOSpecDefault:

  def spec = suite("PendingIdentityRetries")(
    test("a task is handed back at most maxUnlocks times - then it fails like any error") {
      val taskId  = java.util.UUID.randomUUID().toString
      val handed  = (1 to PendingIdentityRetries.maxUnlocks + 2).map(_ => PendingIdentityRetries.unlockAgain(taskId))
      val another = PendingIdentityRetries.unlockAgain(java.util.UUID.randomUUID().toString)
      assertTrue(
        handed.take(PendingIdentityRetries.maxUnlocks).forall(identity),
        handed.drop(PendingIdentityRetries.maxUnlocks).forall(!_),
        another // counted per task
      )
    }
  )
end PendingIdentityRetriesSpec
