package orchescala.engine.domain

import orchescala.engine.domain.EngineError.ServiceRequestError
import zio.test.*

object ServiceRequestErrorSpec extends ZIOSpecDefault:

  def spec = suite("ServiceRequestError.isRefusal")(
    test("a 4xx is a refusal") {
      assertTrue(List(400, 402, 404, 405, 408, 409, 410, 422, 429, 499).forall(ServiceRequestError.isRefusal))
    },
    test("no auth status (401, 403, 407) and nothing outside 4xx") {
      assertTrue(List(0, 200, 302, 399, 401, 403, 407, 500, 503).forall(!ServiceRequestError.isRefusal(_)))
    }
  )
end ServiceRequestErrorSpec
