package orchescala.engine.gateway

import munit.FunSuite
import orchescala.engine.domain.EngineError

class AllServicesFailedTest extends FunSuite:

  private def notFound(engine: String)     = EngineError.ServiceRequestError(404, s"$engine: not found")
  private def unauthorized(engine: String) = EngineError.ServiceRequestError(401, s"$engine: unauthorized")

  test("no engine knows the id: 404 - not 500"):
    val error = allServicesFailed("getProcessInstance", Seq(notFound("C7"), notFound("C8")))
    assertEquals(error.asInstanceOf[EngineError.ServiceRequestError].errorCode, 404)

  test("a rejected token wins over a 404 of the other engine"):
    val error = allServicesFailed("getProcessInstance", Seq(notFound("C8"), unauthorized("C7")))
    assertEquals(error.asInstanceOf[EngineError.ServiceRequestError].errorCode, 401)

  test("an engine that is not reachable: 500 as before - the id may be its own"):
    val error = allServicesFailed(
      "getProcessInstance",
      Seq(notFound("C8"), EngineError.ProcessError("C7: connection refused"))
    )
    assert(error.isInstanceOf[EngineError.ProcessError], error)

  test("the message names all engines"):
    val error = allServicesFailed("getProcessInstance", Seq(notFound("C7"), notFound("C8")))
    assert(error.errorMsg.contains("C7: not found") && error.errorMsg.contains("C8: not found"), error)

end AllServicesFailedTest
