package orchescala.helper.util

import orchescala.domain.BpmnProcessType

class DevConfigTest extends munit.FunSuite:

  val testConfig = DevConfig.init(os.pwd / "04-helper" / "src" / "test" / "resources" / "PROJECT.conf")

  test("without an own sbtVersion the builds get the sbt version of orchescala (sbt 2)"):
    assertEquals(CompanyVersionConfig().sbtVersion, orchescala.BuildInfo.sbtVersion)
    assert(CompanyVersionConfig().sbtVersion.startsWith("2."), CompanyVersionConfig().sbtVersion)

  test("update warns when the build gets another sbt version than orchescala's"):
    import orchescala.helper.dev.update.SbtGenerator
    assertEquals(SbtGenerator.sbtVersionWarning("2.1.0", "2.1.0"), None)
    val warning = SbtGenerator.sbtVersionWarning("1.13.1", "2.1.0")
    assert(warning.exists(w => w.contains("sbt 1.13.1") && w.contains("sbtVersion = BuildInfo.sbtVersion")), warning)

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