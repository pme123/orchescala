package orchescala.engine.c7

import munit.FunSuite
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiException

class C7ServiceStatusTest extends FunSuite:

  private val error = EngineError.ProcessError("Problem getting Process Instance 'x'")

  test("a client error of the engine keeps its status"):
    assertEquals(
      C7Service.withStatus(ApiException(404, "Not Found"))(error),
      EngineError.ServiceRequestError(404, error.errorMsg)
    )
    assertEquals(
      C7Service.withStatus(ApiException(401, "Unauthorized"))(error),
      EngineError.ServiceRequestError(401, error.errorMsg)
    )

  test("an engine error (5xx) and any other failure stay as they are"):
    assertEquals(C7Service.withStatus(ApiException(500, "boom"))(error), error)
    assertEquals(C7Service.withStatus(java.net.ConnectException("refused"))(error), error)

end C7ServiceStatusTest
