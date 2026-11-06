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

class C8ClusterVersionTest extends FunSuite:

  test("a cluster before 8.10 is reported - camunda.processInstance.key is unknown there"):
    assert(C8WorkerRegistry.before810("8.9.21"))
    assert(C8WorkerRegistry.before810("8.8.0"))
    assert(C8WorkerRegistry.before810("7.24.0"))
    assert(!C8WorkerRegistry.before810("8.10.0"))
    assert(!C8WorkerRegistry.before810("8.10.8"))
    assert(!C8WorkerRegistry.before810("8.11.0-SNAPSHOT"))
    assert(!C8WorkerRegistry.before810("9.0.0"))
    // unknown: no warning
    assert(!C8WorkerRegistry.before810(""))
    assert(!C8WorkerRegistry.before810(null))

end C8ClusterVersionTest
