package orchescala.helper.dev.update

import orchescala.helper.util.TestType

case class DirectoryGenerator()(using config: DevConfig):
  lazy val generate =
    os.makeDir.all(config.sbtProjectDir)
    config.modules
      .filter: moduleConfig =>
        config.apiProjectConfig.modules.contains(moduleConfig.moduleType)
      .map:
        generateModule
      
  lazy val generateForGateway =
    os.makeDir.all(config.sbtProjectDir)
    generateModule(ModuleConfig.gatewayModule)

  private def generateModule(moduleConfig: ModuleConfig): Unit =
    def printMainAndTest(
        subProject: Option[String] = None
    ): Unit =
      def srcPath(mainOrTest: String) =
        config.projectDir /
          moduleConfig.packagePath(config.projectPath, mainOrTest, subProject)
      end srcPath
      def resourcesPath(mainOrTest: String) =
        config.projectDir /
          moduleConfig.packagePath(config.projectPath, mainOrTest, subProject, isSourceDir = false)
      end resourcesPath

      os.makeDir.all(srcPath("main"))
      os.makeDir.all(resourcesPath("main"))
      if moduleConfig.testType != TestType.None then
        os.makeDir.all(srcPath("test"))
        os.makeDir.all(resourcesPath("test"))
    end printMainAndTest

    if config.subProjects.nonEmpty && moduleConfig.name == "bpmn"
    then
      config.subProjects
        .foreach: sp =>
          printMainAndTest(Some(sp))
    else printMainAndTest()
    end if

  end generateModule
end DirectoryGenerator
