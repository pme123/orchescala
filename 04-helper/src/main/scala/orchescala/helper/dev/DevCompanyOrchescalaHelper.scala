package orchescala.helper.dev

import orchescala.engine.EngineConfig
import orchescala.helper.dev.company.CompanyGenerator
import orchescala.helper.dev.company.docs.DocCreator
import orchescala.helper.dev.publish.PublishHelper.*
import orchescala.helper.util.{DevConfig, PublishConfig}

import scala.util.{Failure, Success, Try}

// dev-company/company-orchescala/helper.scala
trait DevCompanyOrchescalaHelper extends DocCreator:
  def engineConfig: EngineConfig
  def devConfig: DevConfig

  def runForCompany(command: String, arguments: String*): Unit =
    val args = arguments.toSeq
    println(s"Running for Company command: $command with args: $args")
    Try(Command.valueOf(command)) match
      case Success(cmd) =>
        runCommand(cmd, args)
      case Failure(_) =>
        println(s"Command not found: $command")
        println("Available commands: " + Command.values.mkString(", "))
    end match
  end runForCompany

  protected def publishConfig: Option[PublishConfig] = devConfig.publishConfig

  private def runCommand(command: Command, args: Seq[String]): Unit =
    command match
      case Command.update =>
        update()
      case Command.publish if args.size == 1 =>
        publish(args.head)
      case Command.publish =>
        println("Usage: publish <version>")
      case Command.prepareDocs =>
        prepareDocs()
      case Command.publishDocs =>
        publishDocs()

  private enum Command:
    case update, publish, prepareDocs, publishDocs

  def update(): Unit =
    given EngineConfig = engineConfig
    given DevConfig = devConfig
    println(s"Update Project: ${devConfig.projectName}")
    println(s" - with Subprojects: ${devConfig.subProjects}")
    CompanyGenerator(isInitCompany = false).generate

  private def publish(newVersion: String): Unit =
    println(s"Publishing ${devConfig.projectName}: $newVersion")
    verifyVersion(newVersion)
    //TODO verifySnapshots()
    verifyChangelog(newVersion)
    replaceVersion(newVersion, projectFile)
    println("Versions replaced")
    val isSnapshot = newVersion.contains("-")
    println(s"isSnapshot: $isSnapshot")

    lazy val sbtProcs = Seq(
      "sbt",
      "-J-Xmx3G",
      "publish"
    )

    lazy val gatewayAppFile: os.Path =
      workDir / "04-gateway" / "src" / "main" / "scala" /
        devConfig.projectPath / "gateway" / "GatewayServerApp.scala"

    lazy val sbtDockerProcs =
      if os.exists(gatewayAppFile) then
        Seq(
          "gateway / Docker / publish"
        )
      else
        Seq.empty

    println(s"workerAppFile ${os.exists(gatewayAppFile)}: $gatewayAppFile")
    println(s"SBT: ${(sbtProcs ++ sbtDockerProcs).mkString(" ")}")
    os.proc(sbtProcs ++ sbtDockerProcs).callOnConsole()

    if !isSnapshot then
      git(newVersion, newVers => replaceVersion(newVers, projectFile))
    end if
  end publish

end DevCompanyOrchescalaHelper
