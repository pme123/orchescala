package orchescala.worker.op

import munit.FunSuite
import orchescala.domain.{NoInput, NoOutput}
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.WorkerError.*
import orchescala.worker.{DefaultWorkerConfig, Worker, WorkerError}
import org.operaton.bpm.client.task.ExternalTask
import org.operaton.bpm.client.task.impl.ExternalTaskImpl

class OpWorkerCalcRetriesTest extends FunSuite:

  private lazy val testWorker: OpWorker[NoInput, NoOutput] = new OpWorker[NoInput, NoOutput]:
    protected def operatonContext: OpContext  = null
    def worker: Worker[NoInput, NoOutput, ?] = null

  private val doRetryList = DefaultWorkerConfig(DefaultEngineConfig()).doRetryList

  private def calcRetries(error: WorkerError, currentRetries: Option[Int]): Int =
    val task = ExternalTaskImpl()
    currentRetries.foreach(r => task.setRetries(r))
    given ExternalTask = task
    testWorker.calcRetries(error, doRetryList, inTestMode = false)

  test("IdentityCorrelation pending: quick tries, also in test mode (a simulation)"):
    val task = ExternalTaskImpl()
    given ExternalTask = task
    assertEquals(testWorker.calcRetries(IdentityCorrelationPendingError(), doRetryList, inTestMode = true), 3)
    assertEquals(testWorker.calcRetries(IdentityCorrelationPendingError(), doRetryList, inTestMode = false), 3)

  test("first failure (retries still null): no NullPointerException, no retry for other errors"):
    assertEquals(calcRetries(UnexpectedError("boom"), None), 0)

  test("first failure of a ServiceError: 2 retries"):
    assertEquals(calcRetries(ServiceUnexpectedError("service down"), None), 2)

  test("first failure matching the doRetryList: 2 retries"):
    assertEquals(
      calcRetries(UnexpectedError("Entity was updated by another transaction concurrently"), None),
      2
    )

  test("later failures count down - before, the unchanged count retried without end"):
    assertEquals(calcRetries(ServiceUnexpectedError("service down"), Some(2)), 1)
    assertEquals(calcRetries(ServiceUnexpectedError("service down"), Some(1)), 0)

end OpWorkerCalcRetriesTest
