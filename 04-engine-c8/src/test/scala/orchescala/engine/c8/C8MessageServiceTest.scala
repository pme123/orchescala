package orchescala.engine.c8

import zio.test.*

object C8MessageServiceTest extends ZIOSpecDefault:

  def spec = suite("C8MessageService")(
    test("the processInstanceId wins over the businessKey - like in C7") {
      assertTrue(
        C8MessageService.correlationKey(Some("bk"), Some("2251799813685249")) == Some("2251799813685249"),
        C8MessageService.correlationKey(Some("bk"), None) == Some("bk"),
        C8MessageService.correlationKey(None, Some("2251799813685249")) == Some("2251799813685249"),
        C8MessageService.correlationKey(None, None) == None
      )
    }
  )
end C8MessageServiceTest
