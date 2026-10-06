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

  test("an unknown engineType names the valid ones"):
    val error = intercept[IllegalArgumentException](ApiProjectConfig(projectConf("engineType: C9")))
    assert(error.getMessage.contains("C7, C8 or Op"), error.getMessage)

end ApiProjectConfigEngineTypeTest
