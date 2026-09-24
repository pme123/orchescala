package orchescala.helper.dev.deploy

import io.circe.parser
import orchescala.engine.domain.EngineType
import orchescala.helper.util.{Helpers, PostmanConfig}
import os.proc
import sttp.client3.*

import java.util.Date
import scala.concurrent.duration.*

case class DeployHelper(postmanConfig: PostmanConfig) extends Helpers:

  val collectionId          = postmanConfig.collectionId
  val envId                 = postmanConfig.localDevEnvId
  private val postmanApiKey =
    sys.env.getOrElse(
      postmanConfig.envApiKey,
      throw IllegalStateException(s"Set the Postman API key in the env variable ${postmanConfig.envApiKey}.")
    )

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

    // Collection and environment are downloaded here (API key in a header) and handed to newman as
    // files - with the Postman URLs the key was part of the newman command: printed on the console
    // (callOnConsole), visible in the process list and in newman's error output.
    val collectionFile  = postmanFile("collection", collectionId)
    val environmentFile = postmanFile("environment", envId)

    val newmanCmd = Seq(
      "newman",
      "run",
      collectionFile.toString,
      "-e",
      environmentFile.toString,
      "--folder",
      DeployHelper.deployFolder(engineType),
      "--global-var",
      s"developer=${System.getProperty("user.name").toUpperCase}",
      "--env-var",
      s"tokenService=$ssoBaseUrl",
      "--env-var",
      s"tokenServiceTemp=$ssoBaseUrl"
    )

    try os.proc(newmanCmd).callOnConsole()
    finally Seq(collectionFile, environmentFile).foreach(os.remove(_))

    integrationTest.map { test =>
      val testName = if test == "all" then "" else test
      os.proc("sbt", "-J-Xmx3G", s"simulation/testOnly *$testName").callOnConsole()
    }

    println(s"Deploy and test finished in ${(new Date().getTime - time) / 1000} s")
  end deploy

  /** Downloads a collection / environment from the Postman API into a temp file only the current
    * user can read. The Postman API wraps it (`{"collection": {...}}`) - newman wants it unwrapped.
    */
  private def postmanFile(kind: String, id: String): os.Path =
    val response = basicRequest
      .get(uri"https://api.getpostman.com/${kind}s/$id")
      .header("X-Api-Key", postmanApiKey)
      .readTimeout(30.seconds)
      .response(asStringAlways)
      .send(HttpClientSyncBackend())
    if !response.code.isSuccess then
      throw IllegalStateException(
        s"Could not get the Postman $kind '$id': ${response.code.code} ${response.body.take(300)}"
      )
    val content  = DeployHelper
      .unwrapPostman(kind, response.body)
      .fold(err => throw IllegalStateException(s"Unexpected Postman $kind response: $err"), identity)
    os.temp(
      content,
      prefix = s"postman-$kind-",
      suffix = ".json",
      perms = "rw-------"
    )
  end postmanFile

end DeployHelper

object DeployHelper:

  /** The Postman API answers `{"<kind>": {...}}` - newman wants the inner object. */
  private[deploy] def unwrapPostman(kind: String, body: String): Either[String, String] =
    parser
      .parse(body)
      .left.map(_.message)
      .flatMap(_.hcursor.downField(kind).focus.toRight(s"no '$kind' in the response"))
      .map(_.noSpaces)

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
