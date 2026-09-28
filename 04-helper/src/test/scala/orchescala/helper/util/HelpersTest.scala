package orchescala.helper.util

import munit.FunSuite

import scala.concurrent.duration.*

class HelpersTest extends FunSuite:

  test("waits until ready"):
    var checks = 0
    Helpers.waitUntilReady("container", 5.seconds, 10.millis):
      checks += 1
      checks == 3
    assertEquals(checks, 3)

  test("gives up after maxWait - it waited without end"):
    val error = intercept[IllegalStateException]:
      Helpers.waitUntilReady("container", 100.millis, 10.millis)(false)
    assert(error.getMessage.contains("container is not ready after 100 milliseconds"), error.getMessage)

end HelpersTest
