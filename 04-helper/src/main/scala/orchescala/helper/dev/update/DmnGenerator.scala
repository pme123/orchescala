package orchescala.helper.dev.update


case class DmnGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    createIfNotExists(dmnPath() / "ProjectDmnTester.scala", dmnTester)

  lazy val dmnTester: String =
    s"""package ${config.projectPackage}
       |package dmn
       |
       |//       |
       |// dmn/run
       |object ProjectDmnTester extends CompanyDmnTester:
       |
       |  createDmnConfigs(
       |    // myDmn
       |  )
       |  /* example:
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
