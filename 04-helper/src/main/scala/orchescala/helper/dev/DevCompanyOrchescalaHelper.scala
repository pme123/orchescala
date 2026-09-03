package orchescala.helper.dev

import orchescala.api.VersionHelper
import orchescala.engine.EngineConfig
import orchescala.helper.dev.company.CompanyGenerator
import orchescala.helper.dev.company.docs.DocCreator
import orchescala.helper.dev.publish.OrchDocBuilder
import orchescala.helper.dev.publish.PublishHelper.*
import orchescala.helper.util.{DevConfig, PublishConfig, RepoConfig}

import scala.util.{Failure, Success, Try}

// dev-company/company-orchescala/helper.scala
trait DevCompanyOrchescalaHelper extends DocCreator:
  def engineConfig: EngineConfig
  def devConfig: DevConfig

  def runForCompany(command: String, arguments: String*): Unit =
    registerPrivateRepoLookup()
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

  // `cs complete-dep` only sees Maven Central - fall back to the company's own Artifactory
  // repos (if configured) for private packages before defaulting to a placeholder version.
  private def registerPrivateRepoLookup(): Unit =
    val artifactoryRepos = devConfig.sbtConfig.reposConfig.repos.collect:
      case a: RepoConfig.Artifactory => a
    if artifactoryRepos.nonEmpty then
      VersionHelper.registerPrivateRepoLookup: (project, org) =>
        artifactoryRepos.iterator
          .flatMap(_.versionLookup(project, org))
          .nextOption()
  end registerPrivateRepoLookup

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
    println(s" - Modules: ${devConfig.modules}")

    CompanyGenerator(isInitCompany = false).generate
    os.remove(os.pwd / "04-gateway" / "src" / "main" / "resources" / "site")
    os.symlink(
      os.pwd / "04-gateway" / "src" / "main" / "resources" / "site",
      os.pwd / "00-docs" / "site"
    )
    updateApiHtml()
  end update

  /** orch-doc's single-file API page -> resource of THIS company's helper (see
    * PublishConfig.apiHtmlResource). Built from the local orch-doc checkout (`apiDocPath`), so
    * only the company's `update` needs orch-doc - every project's `update` then gets the page
    * from the company helper jar and writes it as its OpenApi.html / PostmanOpenApi.html.
    */
  private def updateApiHtml(): Unit =
    publishConfig match
      case Some(config) =>
        config.apiDocPath match
          case Some(orchDocPath) =>
            val html = OrchDocBuilder(orchDocPath).buildSingleFile()
            // the helper: for every project's `update`; the gateway: served at /docs for its own API
            Seq("04-helper", "04-gateway")
              .map(os.pwd / _)
              .filter(os.exists)
              .foreach: module =>
                val target = module / "src" / "main" / "resources" / config.apiHtmlResource.segments.last
                os.copy.over(html, target, createFolders = true)
                println(s"${Console.BLUE}Updated - $target (${os.size(target) / 1024} KB)${Console.RESET}")
          case None               =>
            println(
              "No PublishConfig.apiDocPath - the projects' OpenApi.html / PostmanOpenApi.html are NOT updated."
            )
      case None         => ()
  end updateApiHtml

  private def publish(newVersion: String): Unit =
    println(s"Publishing ${devConfig.projectName}: $newVersion")
    verifyVersion(newVersion)
    verifySnapshots()
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
      if os.exists(gatewayAppFile) && devConfig.sbtConfig.dockerGatewaySettings.nonEmpty then
        Seq(
          "gateway / Docker / publish"
        )
      else
        Seq.empty
    println(s"SBT: ${(sbtProcs ++ sbtDockerProcs).mkString(" ")}")
    os.proc(sbtProcs ++ sbtDockerProcs).callOnConsole()

    if !isSnapshot then
      git(newVersion, newVers => replaceVersion(newVers, projectFile))
    end if
  end publish

end DevCompanyOrchescalaHelper
