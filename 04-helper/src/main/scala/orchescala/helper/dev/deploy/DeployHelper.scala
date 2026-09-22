package orchescala.helper.dev.deploy

import orchescala.engine.domain.EngineType
import orchescala.helper.util.{Helpers, PostmanConfig}
import os.proc

import java.util.Date

case class DeployHelper(postmanConfig: PostmanConfig) extends Helpers:

  val collectionId  = postmanConfig.collectionId
  val envId         = postmanConfig.localDevEnvId
  val postmanApiKey = sys.env(postmanConfig.envApiKey)

  def deploy(
      integrationTest: Option[String] = None,
      engineType: EngineType = EngineType.C7
  ): Unit =
    println(s"Publishing Project locally")
    val time = new Date().getTime

    os.proc("sbt", "publishLocal").callOnConsole()

    val ssoBaseUrl = sys.env.getOrElse("SSO_BASE_URL", s"http://host.lima.internal:8090")
    println(s"SSO_BASE_URL = $ssoBaseUrl")
    println(
      s"Deploying to $engineType via Postman folder '${DeployHelper.deployFolder(engineType)}'"
    )

    // Base Newman command
    val newmanCmd = Seq(
      "newman",
      "run",
      s"https://api.getpostman.com/collections/$collectionId?apikey=$postmanApiKey",
      "-e",
      s"https://api.getpostman.com/environments/$envId?apikey=$postmanApiKey",
      "--folder",
      DeployHelper.deployFolder(engineType),
      "--global-var",
      s"developer=${System.getProperty("user.name").toUpperCase}",
      "--env-var",
      s"tokenService=$ssoBaseUrl",
      "--env-var",
      s"tokenServiceTemp=$ssoBaseUrl"
    )

    os.proc(newmanCmd).callOnConsole()

    integrationTest.map { test =>
      val testName = if test == "all" then "" else test
      os.proc("sbt", "-J-Xmx3G", s"simulation/testOnly *$testName").callOnConsole()
    }

    println(s"Deploy and test finished in ${(new Date().getTime - time) / 1000} s")
  end deploy
end DeployHelper

object DeployHelper:

  /** Postman folder that deploys to the given engine. C7 keeps the historic name `deploy_manifest`;
    * every other engine gets a suffixed folder (`deploy_manifest_c8`, …).
    */
  def deployFolder(engineType: EngineType): String =
    engineType match
      case EngineType.C7 => "deploy_manifest"
      case other         => s"deploy_manifest_${other.toString.toLowerCase}"

  /** Engine a simulation targets, derived from its name: `MyProcessC8Simulation` -> C8,
    * `MyProcessOpSimulation` -> Op, anything else -> C7. Mirrors the naming convention of the
    * engine-specific simulation classes; an explicit engine argument on the command line overrides
    * it.
    */
  def engineTypeFromSimulation(simulation: String): EngineType =
    EngineType.values
      .filterNot(_ == EngineType.C7)
      .find(engine => simulation.endsWith(s"${engine}Simulation"))
      .getOrElse(EngineType.C7)

end DeployHelper
