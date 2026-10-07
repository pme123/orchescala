package orchescala.worker.op

import munit.FunSuite
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.WorkerError.*
import orchescala.worker.{DefaultWorkerConfig, WorkerError}
import org.operaton.bpm.client.task.ExternalTask
import org.operaton.bpm.client.task.impl.ExternalTaskImpl

class OpWorkerCalcRetriesTest extends FunSuite:

  private val doRetryList = DefaultWorkerConfig(DefaultEngineConfig()).doRetryList

  private def calcRetries(error: WorkerError, currentRetries: Option[Int]): Int =
    val task = ExternalTaskImpl()
    currentRetries.foreach(r => task.setRetries(r))
    given ExternalTask = task
    OpWorker.calcRetries(error, doRetryList, inTestMode = false)

  test("IdentityCorrelation pending: quick tries, also in test mode (a simulation)"):
    val task = ExternalTaskImpl()
    given ExternalTask = task
    assertEquals(OpWorker.calcRetries(IdentityCorrelationPendingError(), doRetryList, inTestMode = true), 3)
    assertEquals(OpWorker.calcRetries(IdentityCorrelationPendingError(), doRetryList, inTestMode = false), 3)

  test("first failure (retries still null): no NullPointerException, no retry for other errors"):
    assertEquals(calcRetries(UnexpectedError("boom"), None), 0)

  test("first failure of a ServiceError: 2 retries"):
    assertEquals(calcRetries(ServiceUnexpectedError("service down"), None), 2)

  test("a refusal (CustomError.refused) is not retried - like any other CustomError"):
    assertEquals(calcRetries(CustomError.refused(409, "The slot is taken"), None), 0)
    assertEquals(calcRetries(CustomError("failed"), None), 0)

  test("first failure matching the doRetryList: 2 retries"):
    assertEquals(
      calcRetries(UnexpectedError("Entity was updated by another transaction concurrently"), None),
      2
    )

  test("later failures count down - before, the unchanged count retried without end"):
    assertEquals(calcRetries(ServiceUnexpectedError("service down"), Some(2)), 1)
    assertEquals(calcRetries(ServiceUnexpectedError("service down"), Some(1)), 0)

end OpWorkerCalcRetriesTest
