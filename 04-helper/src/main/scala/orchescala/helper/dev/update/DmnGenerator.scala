package orchescala.helper.dev.update

import orchescala.api.ModuleType


case class DmnGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    if config.apiProjectConfig.modules.contains(ModuleType.dmn) then
      createIfNotExists(dmnPath() / "ProjectDmnTester.scala", dmnTester)

  lazy val dmnTester: String =
    s"""package ${config.projectPackage}
       |package dmn
       |
       |// Runs the DMN Tester of this project:
       |//   dmn/runMain ${config.projectPackage}.dmn.ProjectDmnTester
       |// It writes the configurations, starts the tester on
       |// http://localhost:8883 and keeps it running until you stop it (Ctrl-C).
       |object ProjectDmnTester extends CompanyDmnTester:
       |
       |  override protected def dmnTesterObjects = Seq(
       |    // myDmn
       |  )
       |  /* example - `.from("c8")` picks a named DMN source of your company
       |     configuration and writes the config into `dmnConfigs/c8`:
       |  private lazy val myDmn =
       |    import myProcess.v1.*
       |
       |    MyDmn.example
       |      .testUnit
       |      .testValues(
       |        _.value,
       |        1,
       |        2
       |      )
       |      .testValues(
       |        _.age,
       |        64,
       |        65,
       |        66
       |      )
       |      // creates the DMN from the domain object, if there is none yet
       |      // (`.createC8Dmn` for a Camunda 8 DMN)
       |      .createC7Dmn
       |  */
       |
       |end ProjectDmnTester""".stripMargin
  end dmnTester

  private def dmnPath(setupElement: Option[SetupElement] = None) =
    val dir =
      config.projectDir / ModuleConfig.dmnModule.packagePath(config.projectPath)

    os.makeDir.all(dir)
    dir
  end dmnPath

end DmnGenerator
