package orchescala.worker.c7

import munit.FunSuite
import orchescala.domain.{NoInput, NoOutput}
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.WorkerError.*
import orchescala.worker.{DefaultWorkerConfig, Worker, WorkerError}
import org.camunda.bpm.client.task.ExternalTask
import org.camunda.bpm.client.task.impl.ExternalTaskImpl

class C7WorkerCalcRetriesTest extends FunSuite:
  lazy val externalTask = new ExternalTaskImpl()

  given ExternalTask = externalTask

  lazy val testWorker: C7Worker[NoInput, NoOutput] = new C7Worker[NoInput, NoOutput]:
    protected def c7Context: C7Context              = null
    def worker: Worker[NoInput, NoOutput, ?]        = null

  // Simple test helper that replicates the calcRetries logic
  def calcRetries(error: WorkerError, currentRetries: Int, inTestMode: Boolean = false): Int = {
    externalTask.setRetries(currentRetries)
    testWorker.calcRetries(error, DefaultWorkerConfig(DefaultEngineConfig()).doRetryList, inTestMode)
  }

  test("calcRetries - in test mode"):
    val error = UnexpectedError("Some unexpected error")
    val result = calcRetries(error, 3, inTestMode = true)
    assertEquals(result, 0) // retries - 1

  test("calcRetries - retries is null"):
    val error = UnexpectedError("Some unexpected error")
    val result = testWorker.calcRetries(error, DefaultWorkerConfig(DefaultEngineConfig()).doRetryList, false)
    assertEquals(result, 2) // retries - 1

  test("calcRetries - normal error with retries > 0"):
    val error = UnexpectedError("Some unexpected error")
    val result = calcRetries(error, 3)
    assertEquals(result, 2) // retries - 1

  test("calcRetries - normal error with retries = 0"):
    val error = UnexpectedError("Some unexpected error")
    val result = calcRetries(error, 0)
    assertEquals(result, -1) // retries - 1

  test("calcRetries - retryable error with retries > 0"):
    val error = UnexpectedError("An exception occurred in the persistence layer")
    val result = calcRetries(error, 3)
    assertEquals(result, 2) // retries - 1

  test("calcRetries - POST request error with retries = 0 (should not retry)"):
    val error = UnexpectedError("Exception when sending request: POST /api/test")
    val result = calcRetries(error, 0)
    assertEquals(result, -1) // retries - 1, no special retry for POST

  test("calcRetries - non-retryable errors"):
    val error1 = UnexpectedError("Some random error")
    val error2 = UnexpectedError("Exception when sending request: POST /api/test")
    val error3 = UnexpectedError("Exception when sending request: DELETE /api/test")

    assertEquals(calcRetries(error1, 3), 2) // normal retry decrement
    assertEquals(calcRetries(error2, 0), -1) // POST not retryable
    assertEquals(calcRetries(error3, 0), -1) // DELETE not retryable

end C7WorkerCalcRetriesTest
