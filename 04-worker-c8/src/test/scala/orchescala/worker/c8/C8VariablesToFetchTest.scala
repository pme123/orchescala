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

  test("a worker fetches the general variables - not the businessKey, the job carries its business id"):
    assert(!C8Worker.variablesToFetch(customWorker).contains("businessKey"))
    assert(GeneralVariables.variableNames.forall(C8Worker.variablesToFetch(customWorker).contains))

  test("no worker fetches processInstanceId - the own id is camunda.processInstance.key in FEEL"):
    assert(!C8Worker.variablesToFetch(initWorker).contains("processInstanceId"))
    assert(!C8Worker.variablesToFetch(customWorker).contains("processInstanceId"))

  test("the business key is the business id of the job - none if blank or missing"):
    def job(businessId: String | Null) =
      new io.camunda.client.impl.response.ActivatedJobImpl(
        new io.camunda.client.impl.CamundaObjectMapper(),
        new io.camunda.client.protocol.rest.ActivatedJobResult()
          .jobKey("1").processInstanceKey("2").processDefinitionKey("3").elementInstanceKey("4")
          .rootProcessInstanceKey("2").businessId(businessId)
      )
    assertEquals(C8Worker.businessKeyOf(job("bk-1")), "bk-1")
    assertEquals(C8Worker.businessKeyOf(job(" ")), "no businessKey")
    assertEquals(C8Worker.businessKeyOf(job(null)), "no businessKey")

end C8VariablesToFetchTest
