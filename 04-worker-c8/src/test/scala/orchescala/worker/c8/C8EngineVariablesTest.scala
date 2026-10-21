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

end C8EngineVariablesTest
