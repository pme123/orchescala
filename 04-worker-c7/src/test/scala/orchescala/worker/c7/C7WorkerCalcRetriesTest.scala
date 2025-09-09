package orchescala.worker.c7

import orchescala.worker.{WorkerConfig, WorkerError}
import orchescala.worker.WorkerError.*
import munit.FunSuite
import org.camunda.bpm.client.task.ExternalTask
import org.camunda.bpm.client.task.impl.ExternalTaskImpl

class C7WorkerCalcRetriesTest extends FunSuite:
  lazy val externalTask = new ExternalTaskImpl()
  externalTask.setRetries(0)
  given ExternalTask = externalTask

  // Simple test helper that replicates the calcRetries logic
  def calcRetries(error: WorkerError, currentRetries: Int): Int = {
    externalTask.setRetries(currentRetries)
    C7Worker.calcRetries(error, WorkerConfig.default.doRetryList)
  }

  test("calcRetries - normal error with retries > 0"):
    val error = UnexpectedError("Some unexpected error")
    val result = calcRetries(error, 3)
    assertEquals(result, 2) // retries - 1

  test("calcRetries - normal error with retries = 0"):
    val error = UnexpectedError("Some unexpected error")
    val result = calcRetries(error, 0)
    assertEquals(result, -1) // retries - 1

  test("calcRetries - retryable error with retries = 0"):
    val error = UnexpectedError("Entity was updated by another transaction concurrently")
    val result = calcRetries(error, 0)
    assertEquals(result, 2) // special case: reset to 2 retries

  test("calcRetries - retryable error with retries > 0"):
    val error = UnexpectedError("An exception occurred in the persistence layer")
    val result = calcRetries(error, 3)
    assertEquals(result, 2) // retries - 1

  test("calcRetries - GET request error with retries = 0"):
    val error = UnexpectedError("Exception when sending request: GET /api/test")
    val result = calcRetries(error, 0)
    assertEquals(result, 2) // special case: reset to 2 retries

  test("calcRetries - PUT request error with retries = 0"):
    val error = UnexpectedError("Exception when sending request: PUT /api/test")
    val result = calcRetries(error, 0)
    assertEquals(result, 2) // special case: reset to 2 retries

  test("calcRetries - POST request error with retries = 0 (should not retry)"):
    val error = UnexpectedError("Exception when sending request: POST /api/test")
    val result = calcRetries(error, 0)
    assertEquals(result, -1) // retries - 1, no special retry for POST

  test("calcRetries - case insensitive matching"):
    val error = UnexpectedError("ENTITY WAS UPDATED BY ANOTHER TRANSACTION CONCURRENTLY")
    val result = calcRetries(error, 0)
    assertEquals(result, 2) // should match case-insensitively

  test("calcRetries - partial message matching"):
    val error = UnexpectedError("Some error: An exception occurred in the persistence layer - details")
    val result = calcRetries(error, 0)
    assertEquals(result, 2) // should match partial message

  test("calcRetries - negative retries with retryable error"):
    val error = UnexpectedError("Entity was updated by another transaction concurrently")
    val result = calcRetries(error, -1)
    assertEquals(result, 2) // special case: reset to 2 retries
  test("calcRetries - Unexpected error while sending request: Exception when sending request: GET https://"):
    val error = UnexpectedError("Unexpected error while sending request: Exception when sending request: GET https://")
    val result = calcRetries(error, -1)
    assertEquals(result, 2) // special case: reset to 2 retries
    
  test("calcRetries - Unexpected error in Cause"):
    val error = CustomError("my error", causeError = Some(UnexpectedError("Unexpected error while sending request: Exception when sending request: GET https://")))
    val result = calcRetries(error, -1)
    assertEquals(result, 2) // special case: reset to 2 retries

  test("calcRetries - multiple retry conditions"):
    val error1 = UnexpectedError("Entity was updated by another transaction concurrently")
    val error2 = UnexpectedError("An exception occurred in the persistence layer")
    val error3 = UnexpectedError("Exception when sending request: GET /api/test")
    val error4 = UnexpectedError("Exception when sending request: PUT /api/test")

    assertEquals(calcRetries(error1, 0), 2)
    assertEquals(calcRetries(error2, 0), 2)
    assertEquals(calcRetries(error3, 0), 2)
    assertEquals(calcRetries(error4, 0), 2)

  test("calcRetries - non-retryable errors"):
    val error1 = UnexpectedError("Some random error")
    val error2 = UnexpectedError("Exception when sending request: POST /api/test")
    val error3 = UnexpectedError("Exception when sending request: DELETE /api/test")

    assertEquals(calcRetries(error1, 3), 2) // normal retry decrement
    assertEquals(calcRetries(error2, 0), -1) // POST not retryable
    assertEquals(calcRetries(error3, 0), -1) // DELETE not retryable

end C7WorkerCalcRetriesTest
