package orchescala.worker.c8

import io.circe.Json
import munit.FunSuite

import scala.jdk.CollectionConverters.*

class C8BpmnErrorVariablesTest extends FunSuite:

  test("the variables of a BPMN error are engine values - a circe Json (e.g. a mocked output) too"):
    val vars = C8Worker.bpmnErrorVariables(Map(
      "receivingSystems" -> Json.arr(Json.fromString("GRAVITON"), Json.fromString("CAM")),
      "subStatus"        -> Json.obj("subStatusActions" -> Json.fromString("mockedActions")),
      "errorCode"        -> "output-mocked"
    ))
    assertEquals(vars("receivingSystems").asInstanceOf[java.util.List[Any]].asScala.toList, List[Any]("GRAVITON", "CAM"))
    assertEquals(vars("subStatus").asInstanceOf[java.util.Map[String, Any]].asScala.toMap, Map[String, Any]("subStatusActions" -> "mockedActions"))
    assertEquals(vars("errorCode"), "output-mocked": Any)
    assert(!vars.values.exists(_.isInstanceOf[Json]))

end C8BpmnErrorVariablesTest
