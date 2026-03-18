package orchescala.helper.dev.company

import orchescala.api.*
import orchescala.api.defaultProjectConfigPath
import orchescala.engine.EngineConfig
import orchescala.helper.dev.update.*

case class CompanyGenerator(isInitCompany: Boolean = true)(using config: DevConfig, engineConfig: EngineConfig):

  lazy val basePath = if isInitCompany then os.pwd else os.pwd / os.up
  
  lazy val generate: Unit =
    
    generateDirectories
    DirectoryGenerator().generate // generates myCompany-orchescala project
    GenericFileGenerator().createScalaFmt
    GenericFileGenerator().createGitIgnore
    // needed helper classes
    CompanyWrapperGenerator().generate(engineConfig.supportedEngines)
    // override helperCompany.scala
    if isInitCompany then
      createOrUpdate(basePath / "helperCompany.scala", CompanyScriptCreator().companyHelper)
    // sbt
    CompanySbtGenerator().generate
    // company-orchescala
    // helper.scala
    createOrUpdate(companyOrchescala / "helper.scala", CompanyScriptCreator().companyOrchescalaHelper)
    // docs
    CompanyDocsGenerator(companyOrchescala).generate
  end generate

  lazy val createProject: Unit =
    generateProjectDirectories
    createOrUpdate(projectsPath / projectName / "helper.scala", ScriptCreator().projectHelper)
  end createProject

  private lazy val companyName = config.companyName
  private lazy val projectName = config.projectName

  private lazy val generateDirectories: Unit =
    os.makeDir.all(gitTemp)
    os.makeDir.all(docker)
    os.makeDir.all(companyOrchescala)
    os.makeDir.all(projectsPath)

  end generateDirectories

  private lazy val generateProjectDirectories: Unit =
    os.makeDir.all(projectsPath / projectName)

  private lazy val gitTemp = basePath / os.up / "git-temp"
  private lazy val docker = basePath / "docker"
  private lazy val companyOrchescala = basePath / s"$companyName-orchescala"
  
end CompanyGenerator

