package orchescala.api

import com.typesafe.config.ConfigFactory
import scala.jdk.CollectionConverters.*

final case class ApiProjectConfig(
    projectName: String,
    projectVersion: VersionConfig,
    subProjects: Seq[String],
    dependencies: Seq[DependencyConfig],
    // additional dependencies for the worker module only
    workerDependencies: Seq[DependencyConfig]
):
  lazy val companyName: String = projectName.split("-").head
end ApiProjectConfig

object ApiProjectConfig:

  def init(projectName: String, newPackageFile: os.Path = os.pwd / defaultProjectConfigPath) =
    if !os.exists(newPackageFile)
    then
      println(s"Created initial $newPackageFile")
      os.makeDir.all(newPackageFile / os.up)
      os.write(
        newPackageFile,
        s"""
           |projectName: $projectName
           |projectVersion: ${DocProjectConfig.defaultVersion}
           |subProjects: [
           |  // subProject1
           |  // subProject2
           |]
           |dependencies: [
           |  // example-helper
           |  // example-accounts
           |]
           |// dependecies only for the worker module
           |workerDependencies: [
           |  // example-worker
           |]
           |""".stripMargin
      )
    end if
    apply(newPackageFile)
  end init

  def apply(projectConfigPath: os.Path = os.pwd / defaultProjectConfigPath): ApiProjectConfig =
    val projectConfig  = ConfigFactory.parseFile(projectConfigPath.toIO)
    val projectName    = projectConfig.getString("projectName")
    val projectVersion = projectConfig.getString("projectVersion")
    val subProjects    = projectConfig.getStringList("subProjects").asScala.toSeq
    val dependencies   =
      projectConfig.getStringList("dependencies").asScala.map(DependencyConfig.apply).toSeq
    val workerDependencies =
      if projectConfig.hasPath("workerDependencies") then
        projectConfig.getStringList("workerDependencies").asScala.map(DependencyConfig.apply).toSeq
      else Seq.empty

    ApiProjectConfig(
      projectName,
      VersionConfig(projectVersion),
      subProjects,
      dependencies,
      workerDependencies
    )
  end apply

  def apply(projectName: String, projectVersion: String): ApiProjectConfig =
    ApiProjectConfig(
      projectName = projectName,
      projectVersion = VersionConfig(projectVersion),
      subProjects = Seq.empty,
      dependencies = Seq.empty,
      workerDependencies = Seq.empty
    )
end ApiProjectConfig

case class VersionConfig(major: Int, minor: Int, patch: Int, isSnapshot: Boolean = false):
  def isMajor(version: VersionConfig): Boolean =
    major != version.major

  def isMinor(version: VersionConfig): Boolean =
    major == version.major && minor != version.minor

  def isPatch(version: VersionConfig): Boolean =
    major == version.major && minor == version.minor && patch != version.patch

  lazy val minorVersion: String = s"$major.$minor"
  lazy val versionAsInt: Int    =
    major * 100000 + minor * 1000 + patch

  override def toString: String = s"$minorVersion.$patch${if isSnapshot then "-SNAPSHOT" else ""}"
  def isHigherThan(config: VersionConfig): Boolean =
    versionAsInt > config.versionAsInt
end VersionConfig

object VersionConfig:
  def apply(version: String): VersionConfig =
    version.split("\\.") match
      case Array(major, minor, patch) =>
        if patch.endsWith("-SNAPSHOT") then
          VersionConfig(major.toInt, minor.toInt, patch.dropRight(9).toInt, isSnapshot = true)
        else
          VersionConfig(major.toInt, minor.toInt, patch.toInt)
end VersionConfig

final case class DependencyConfig(
    projectName: String,
    projectVersion: VersionConfig
):
  lazy val minorVersion: String = projectVersion.minorVersion
  lazy val companyName: String  = projectName.split("-").head
  lazy val fullName             = s"$companyName:$projectName:$projectVersion"
  lazy val projectPackage       = s"${projectName.split("-").mkString(".")}"

  def equalTo(packageConf: DocProjectConfig): Boolean =
    packageConf.companyName == companyName && packageConf.projectName == projectName && packageConf.minorVersion == projectVersion.minorVersion
end DependencyConfig

object DependencyConfig:
  def apply(projectName: String): DependencyConfig =
    val lastVersion = VersionHelper.repoSearch(projectName)
    DependencyConfig(projectName, VersionConfig(lastVersion))

end DependencyConfig
