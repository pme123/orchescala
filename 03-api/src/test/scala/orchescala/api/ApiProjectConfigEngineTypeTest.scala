package orchescala.api

import munit.FunSuite
import orchescala.domain.BpmnProcessType

class ApiProjectConfigEngineTypeTest extends FunSuite:

  // without dependencies - so no coursier lookup is needed
  private def projectConf(extra: String): os.Path =
    os.temp(
      s"""projectName: mycompany-myProject
         |projectVersion: 1.0.0-SNAPSHOT
         |subProjects: []
         |dependencies: []
         |$extra
         |""".stripMargin,
      suffix = ".conf"
    )

  test("engineType: Op"):
    assertEquals(ApiProjectConfig(projectConf("engineType: Op")).engineType, Some(BpmnProcessType.Op()))

  test("engineType is case insensitive"):
    assertEquals(ApiProjectConfig(projectConf("engineType: c8")).engineType, Some(BpmnProcessType.C8()))

  test("without engineType - the company's default"):
    assertEquals(ApiProjectConfig(projectConf("")).engineType, None)

  test("engineType with surrounding spaces"):
    assertEquals(ApiProjectConfig(projectConf("engineType: \" Op \"")).engineType, Some(BpmnProcessType.Op()))

  test("an unknown engineType names the value as written, the valid ones and the file"):
    val conf  = projectConf("engineType: C9")
    val error = intercept[IllegalArgumentException](ApiProjectConfig(conf))
    assert(error.getMessage.contains("'C9'"), error.getMessage)
    assert(error.getMessage.contains("C7, C8 or Op"), error.getMessage)
    assert(error.getMessage.contains(conf.toString), error.getMessage)

  test("an empty engineType is an error, not the company's default"):
    val error = intercept[IllegalArgumentException](ApiProjectConfig(projectConf("engineType: \"\"")))
    assert(error.getMessage.contains("C7, C8 or Op"), error.getMessage)

end ApiProjectConfigEngineTypeTest
