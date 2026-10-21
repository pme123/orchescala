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

  test("the InitWorker puts the processInstanceId into the process variables - as a String"):
    assertEquals(
      C8Worker.engineVariables(initWorker, processInstanceKey, None),
      Map("processInstanceId" -> "9007199254741234")
    )

  test("a key given from outside wins - a number becomes a String, an empty one does not count"):
    assertEquals(
      C8Worker.engineVariables(initWorker, processInstanceKey, Some(Json.fromString("outside-key"))),
      Map("processInstanceId" -> "outside-key")
    )
    assertEquals(
      C8Worker.engineVariables(initWorker, processInstanceKey, Some(Json.fromLong(9007199254741299L))),
      Map("processInstanceId" -> "9007199254741299")
    )
    assertEquals(
      C8Worker.engineVariables(initWorker, processInstanceKey, Some(Json.fromString(""))),
      Map("processInstanceId" -> "9007199254741234")
    )

  test("another worker does not - e.g. one of a called process must not overwrite it"):
    assertEquals(C8Worker.engineVariables(customWorker, processInstanceKey, None), Map.empty[String, String])
    assertEquals(C8Worker.engineVariableNames(customWorker), Seq.empty)

  test("only the InitWorker fetches a given processInstanceId"):
    assertEquals(C8Worker.engineVariableNames(initWorker), Seq("processInstanceId"))

end C8EngineVariablesTest
