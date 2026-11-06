package orchescala.worker.c8

import munit.FunSuite
import orchescala.domain.*
import orchescala.worker.*

class C8VariablesToFetchTest extends FunSuite:

  private val initWorker = InitWorker[NoInput, NoOutput, NoInput](
    Process(InOutDescr("my-process", NoInput(), NoOutput(), None), NoInput(), ProcessLabels.none),
    ValidationHandler(Right(_))
  )

  private val customWorker = CustomWorker[NoInput, NoOutput](
    CustomTask(InOutDescr("my-topic", NoInput(), NoOutput(), None)),
    ValidationHandler(Right(_))
  )

  test("a worker fetches the general variables and the businessKey"):
    assert(C8Worker.variablesToFetch(customWorker).contains("businessKey"))
    assert(GeneralVariables.variableNames.forall(C8Worker.variablesToFetch(customWorker).contains))

  test("no worker fetches processInstanceId - the own id is camunda.processInstance.key in FEEL"):
    assert(!C8Worker.variablesToFetch(initWorker).contains("processInstanceId"))
    assert(!C8Worker.variablesToFetch(customWorker).contains("processInstanceId"))

end C8VariablesToFetchTest
