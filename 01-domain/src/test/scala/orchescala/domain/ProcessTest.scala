package orchescala.domain

import munit.FunSuite

class ProcessTest extends FunSuite:

  test("camundaInBody") {
    val process = Process(
      InOutDescr("mycompany-myproject-myprocessV1", NoInput(), NoOutput()),
      NoInput(),
      ProcessLabels.none
    )
    assertEquals(process.camundaInBody, Json.obj("_servicesMocked" -> Json.fromBoolean(false), "_mockedWorkers" -> Json.arr()).asObject.get)
  }
