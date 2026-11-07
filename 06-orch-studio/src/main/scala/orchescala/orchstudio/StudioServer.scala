package orchescala.orchstudio

import zio.*
import zio.http.*

/** The studio of a company - like its gateway, the company makes it an object in
  * `<company>-orchescala`, module `studio`:
  * {{{
  * object StudioServerApp extends StudioServer:
  *   lazy val config = StudioConfig().withEnv()
  * }}}
  * It serves the documentation apps (see [[SiteRoutes]]), the services on a specification (see
  * [[SpecRoutes]]) and the AI of orch-spec (see [[AiRoutes]]); more REST of the studio comes later.
  */
abstract class StudioServer extends ZIOAppDefault:

  def config: StudioConfig

  /** More routes of the company - they come before the studio's. */
  def companyRoutes: Routes[Any, Response] = Routes.empty

  private def routesOf(settings: StudioConfig, ai: AiRoutes): Routes[Any, Response] =
    companyRoutes ++ SpecRoutes.routes ++ ai.routes ++ SiteRoutes(settings.site).routes

  def run: ZIO[Any, Throwable, Unit] =
    // the settings come from the environment (withEnv) - a wrong one ends the start with one line
    // that names it, not with a stack trace
    ZIO.attempt(config)
      .tapError(e => ZIO.logError(s"Orch Studio does not start - the settings: ${Option(e.getMessage).getOrElse(e.toString)}"))
      .flatMap(serve)

  private def serve(settings: StudioConfig): ZIO[Any, Throwable, Unit] =
    val url = s"http://${settings.host}:${settings.port}"
    val start =
      for
        _ <- ZIO.logInfo(s"Orch Studio on $url")
        _ <- ZIO.when(SiteSource.orchDocApps().isEmpty):
               ZIO.logWarning("orchescala-orch-doc is not on the classpath - no orch-doc, orch-spec, orch-ops")
        _ <- ZIO.logInfo(s"Documentation: ${settings.siteDir.fold("from the classpath (site/)")(_.toString)}")
        _ <- ZIO.logInfo(s"  orch-doc  $url/site/")
        _ <- ZIO.logInfo(s"  orch-spec $url/site/spec/")
        _ <- ZIO.logInfo(s"  orch-ops  $url/site/ops/")
        _ <- ZIO.logInfo(settings.ai.fold("AI: off - without STUDIO_AI_ANTHROPIC_API_KEY orch-spec shows no AI")(a =>
               s"AI: on - $a, tasks with a skill: ${AiSkills.available(AiRoutes.provider).map(_.id).mkString(", ")}"))
        ai <- ZIO.serviceWithZIO[Client](AiRoutes.make(settings.ai, _))
        _ <- Server.serve(routesOf(settings, ai))
      yield ()
    start.provide(
      Server.defaultWith(c => StudioServer.serverConfig(c.binding(settings.host, settings.port))),
      Client.default
    )

end StudioServer

object StudioServer:

  /** The settings of the HTTP server: a request body is read up to [[maxBody]] - also a chunked one;
    * a bigger body is refused before it is in memory. Each service checks its own limit below.
    */
  def serverConfig(config: Server.Config): Server.Config =
    config.disableRequestStreaming(maxBody)

  /** The largest body of a service of the studio - the requests of the AI. */
  val maxBody: Int = math.max(SpecRoutes.maxBody, AiRoutes.maxBody)

/** Without a company: `sbt orchStudio/run`, the documentation from `STUDIO_SITE_DIR`. */
object LocalStudioServerApp extends StudioServer:
  lazy val config: StudioConfig = StudioConfig().withEnv()
