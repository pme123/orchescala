package orchescala.helper.util

import orchescala.domain.BpmnProcessType

class DevConfigTest extends munit.FunSuite:

  val testConfig = DevConfig.init(os.pwd / "04-helper" / "src" / "test" / "resources" / "PROJECT.conf")

  test("dependsOn with no dependencies"):
    assertEquals(
      testConfig.dependsOn(1),
      ""
    )

  test("dependsOn with single level dependency"):
    assertEquals(
      testConfig.dependsOn(3),
      ".dependsOn(domain)"
    )

  test("dependsOn with multiple dependencies"):
    assertEquals(
      testConfig.dependsOn(4),
      ".dependsOn(api, dmn, simulation, worker)"
    )

  test("dependsOn with level higher than available modules"):
    assertEquals(
      testConfig.dependsOn(5),
      ".dependsOn(api, dmn, simulation, worker)"
    )

  test("projectBpmnProcessType - the project's engineType wins"):
    val config = testConfig.copy(
      apiProjectConfig = testConfig.apiProjectConfig.copy(engineType = Some(BpmnProcessType.Op())),
      bpmnProcessType = BpmnProcessType.C8()
    )
    assertEquals(config.projectBpmnProcessType, BpmnProcessType.Op())

  test("projectBpmnProcessType - without engineType the company's default"):
    val config = testConfig.copy(
      apiProjectConfig = testConfig.apiProjectConfig.copy(engineType = None),
      bpmnProcessType = BpmnProcessType.C8()
    )
    assertEquals(config.projectBpmnProcessType, BpmnProcessType.C8())

end DevConfigTest