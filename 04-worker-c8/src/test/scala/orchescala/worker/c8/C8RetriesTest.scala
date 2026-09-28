package orchescala.worker.c8

import munit.FunSuite
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.DefaultWorkerConfig
import orchescala.worker.WorkerError.*

class C8RetriesTest extends FunSuite:

  private val doRetryList = DefaultWorkerConfig(DefaultEngineConfig()).doRetryList

  test("an error not worth trying again: an incident at once - it counted down the job's 3 retries"):
    assertEquals(C8Worker.retriesAfter(ValidatorError("amount must be positive"), 3, doRetryList), 0)
    assertEquals(C8Worker.retriesAfter(UnexpectedError("bug"), 3, doRetryList), 0)

  test("a ServiceError counts down the retries of the job"):
    assertEquals(C8Worker.retriesAfter(ServiceUnexpectedError("service down"), 3, doRetryList), 2)
    assertEquals(C8Worker.retriesAfter(ServiceUnexpectedError("service down"), 1, doRetryList), 0)
    assertEquals(
      C8Worker.retriesAfter(CustomError("failed", causeError = Some(ServiceUnexpectedError("down"))), 3, doRetryList),
      2
    )

  test("an error of the doRetryList, a pending identity, a temporary error count down too"):
    assertEquals(
      C8Worker.retriesAfter(UnexpectedError("Entity was updated by another transaction concurrently"), 3, doRetryList),
      2
    )
    assertEquals(C8Worker.retriesAfter(IdentityCorrelationPendingError(), 3, doRetryList), 2)
    assertEquals(C8Worker.retriesAfter(UnexpectedError("complete failed"), 3, doRetryList, doRetry = true), 2)

  test("never below 0"):
    assertEquals(C8Worker.retriesAfter(ServiceUnexpectedError("service down"), 0, doRetryList), 0)

end C8RetriesTest
