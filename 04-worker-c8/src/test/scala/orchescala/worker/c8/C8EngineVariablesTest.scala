package orchescala.worker.c8

import munit.FunSuite
import orchescala.domain.*
import orchescala.worker.*

class C8EngineVariablesTest extends FunSuite:

  // a key of partition 4 - above JavaScript's safe integers (2^53)
  private val processInstanceKey = 9007199254741234L

  private val initWorker = InitWorker[NoInput, NoOutput, NoInput](
    Process(InOutDescr("my-process", NoInput(), NoOutput(), None), NoInput(), ProcessLabels.none),
    ValidationHandler(Right(_))
  )

  private val customWorker = CustomWorker[NoInput, NoOutput](
    CustomTask(InOutDescr("my-topic", NoInput(), NoOutput(), None)),
    ValidationHandler(Right(_))
  )

  test("the InitWorker puts the own processInstanceId into the process variables - as a String"):
    assertEquals(
      C8Worker.engineVariables(initWorker, processInstanceKey),
      Map("processInstanceId" -> "9007199254741234")
    )

  test("another worker does not - e.g. one of a called process must not overwrite it"):
    assertEquals(C8Worker.engineVariables(customWorker, processInstanceKey), Map.empty[String, String])

  test("an id from outside that is not the own one is reported - only for the InitWorker"):
    val outside = Json.obj("processInstanceId" -> Json.fromString("b28def14-dd03-11ed-b268-0242ac120006"))
    assertEquals(C8Worker.foreignProcessInstanceId(initWorker, outside, processInstanceKey), Some("b28def14-dd03-11ed-b268-0242ac120006"))
    assertEquals(C8Worker.foreignProcessInstanceId(initWorker, Json.obj("processInstanceId" -> Json.fromString("9007199254741234")), processInstanceKey), None)
    assertEquals(C8Worker.foreignProcessInstanceId(initWorker, Json.obj("processInstanceId" -> Json.Null), processInstanceKey), None)
    assertEquals(C8Worker.foreignProcessInstanceId(customWorker, outside, processInstanceKey), None)

  test("the InitWorker fetches a processInstanceId from outside - so it can report overwriting it"):
    assert(C8Worker.variablesToFetch(initWorker).contains("processInstanceId"))
    assert(!C8Worker.variablesToFetch(customWorker).contains("processInstanceId"))
    assert(C8Worker.variablesToFetch(customWorker).contains("businessKey"))

end C8EngineVariablesTest
