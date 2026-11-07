package orchescala.worker

import io.circe.Json
import orchescala.engine.domain.{DeploymentEntry, EngineType}
import orchescala.engine.rest.SttpClientBackend
import sttp.client3.*
import sttp.model.Uri
import zio.*

import scala.concurrent.duration.FiniteDuration

/** Deploys the BPMN/DMN of a worker app's project when the app starts - through the gateway:
  * `POST <gatewayUrl>/deployment?targetEngine=<engine>` with the manifest of the project, once per
  * engine the app has workers for ([[WorkerRegistry.engineType]]). The gateway reads the resources
  * from the project's jar (Ivy local or a repository, see `RepositoryManifestResolver`) - from the
  * folder of the engine (`camunda8` for C8, `operaton` or else `camunda` for Op, `camunda` for C7).
  *
  * The gateway may start after the worker app: a failed attempt is retried every `retryInterval`
  * for at most `maxWait`, then logged as an error - the worker app keeps running either way.
  *
  * @param gatewayUrl the gateway, e.g. `http://gateway:8888`
  * @param token      the Bearer token for the gateway (e.g. of a technical user) - run per attempt,
  *                   with the HTTP client of the worker app
  * @param entry      the project to deploy - by default the worker app's own ([[DeployOnStart.entryOf]])
  */
case class DeployOnStart(
    gatewayUrl: String,
    token: ZIO[SttpClientBackend, Any, String],
    entry: Option[DeploymentEntry] = None,
    retryInterval: Duration = 5.seconds,
    maxWait: Duration = 5.minutes
)

object DeployOnStart:

  /** The project of a worker app: the name is its `applicationName` (`<company>-<project>`, from
    * the package `company.project.worker`), the company its first part, the version that of its
    * jar (`Implementation-Version`) - None without a version (the app does not run from a jar, e.g.
    * `sbt run`).
    */
  def entryOf(applicationName: String, version: Option[String]): Option[DeploymentEntry] =
    for
      v       <- version.filter(_.nonEmpty)
      company <- applicationName.split('-').headOption.filter(_.nonEmpty)
    yield DeploymentEntry(company, applicationName, v)

  /** The body of `POST /deployment`. */
  def manifestJson(entry: DeploymentEntry): Json =
    Json.obj(
      "deployments" -> Json.arr(
        Json.obj(
          "company" -> Json.fromString(entry.company),
          "project" -> Json.fromString(entry.project),
          "version" -> Json.fromString(entry.version)
        )
      )
    )

  def run(
      config: DeployOnStart,
      entry: DeploymentEntry,
      engines: Seq[EngineType]
  ): ZIO[SttpClientBackend, Nothing, Unit] =
    ZIO.foreachDiscard(engines.distinct): engine =>
      deployTo(config, entry, engine)
        .tapError: err =>
          ZIO.logWarning(
            s"Deploy of ${entry.deploymentName} to $engine via ${config.gatewayUrl} failed - next try in ${config.retryInterval.render}: $err"
          )
        .retry(Schedule.spaced(config.retryInterval) && Schedule.upTo(config.maxWait))
        .foldZIO(
          err =>
            ZIO.logError(
              s"Deploy of ${entry.deploymentName} to $engine via ${config.gatewayUrl} given up after ${config.maxWait.render}: $err"
            ),
          deployed => ZIO.logInfo(s"Deployed ${entry.deploymentName} to $engine: $deployed")
        )

  private def deployTo(
      config: DeployOnStart,
      entry: DeploymentEntry,
      engine: EngineType
  ): ZIO[SttpClientBackend, String, String] =
    for
      token    <- config.token.mapError(err => s"no token for the gateway: ${errorText(err)}")
      uri      <- ZIO
                    .fromEither(Uri.parse(config.gatewayUrl.stripSuffix("/")))
                    .map(_.addPath("deployment").addParam("targetEngine", engine.toString))
                    .mapError(err => s"invalid gateway URL ${config.gatewayUrl}: $err")
      response <- ZIO
                    .serviceWithZIO[SttpClientBackend]: backend =>
                      basicRequest
                        .post(uri)
                        .header("Authorization", s"Bearer $token")
                        .contentType("application/json")
                        .body(manifestJson(entry).noSpaces)
                        .readTimeout(FiniteDuration(2, "minutes"))
                        .response(asStringAlways)
                        .send(backend)
                    .mapError(err => s"gateway not reachable: ${err.getMessage}")
      deployed <- if response.code.isSuccess then ZIO.succeed(deployedKeys(response.body))
                  else ZIO.fail(s"${response.code.code} ${response.body.take(500)}")
    yield deployed

  private def errorText(err: Any): String =
    err match
      case t: Throwable => t.getMessage
      case other        => other.toString

  /** The keys of the deployed processes and decisions - or the body, if it is not the expected JSON. */
  private[worker] def deployedKeys(body: String): String =
    io.circe.parser.parse(body).toOption
      .flatMap(_.asArray)
      .map: results =>
        results
          .flatMap: result =>
            Seq("deployedProcesses", "deployedDecisions").flatMap: field =>
              result.hcursor.downField(field).focus.flatMap(_.asArray).toSeq.flatten
                .flatMap(_.hcursor.get[String]("key").toOption)
          .distinct
          .sorted
          .mkString(", ")
      .filter(_.nonEmpty)
      .getOrElse(body.take(500))

end DeployOnStart
