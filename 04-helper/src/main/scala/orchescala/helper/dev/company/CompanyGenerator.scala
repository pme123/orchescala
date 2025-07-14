package orchescala.helper.dev.company

import orchescala.api.*
import orchescala.api.defaultProjectConfigPath
import orchescala.helper.dev.update.*

case class CompanyGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    generateDirectories
    DirectoryGenerator().generate // generates myCompany-orchescala project
    GenericFileGenerator().createScalaFmt
    GenericFileGenerator().createGitIgnore
    // needed helper classes
    CompanyWrapperGenerator().generate
    // override helperCompany.scala
    createOrUpdate(os.pwd / "helperCompany.scala", CompanyScriptCreator().companyHelper)
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

  private lazy val gitTemp = os.pwd / os.up / "git-temp"
  private lazy val docker = os.pwd / "docker"
  private lazy val companyOrchescala = os.pwd / s"$companyName-orchescala"
  
end CompanyGenerator

