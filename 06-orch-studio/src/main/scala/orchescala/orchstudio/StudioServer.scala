package orchescala.orchstudio

import zio.*
import zio.http.*

/** The studio of a company - like its gateway, the company makes it an object in
  * `<company>-orchescala`, module `studio`:
  * {{{
  * object StudioServerApp extends StudioServer:
  *   lazy val config = StudioConfig().withEnv()
  * }}}
  * It serves the documentation apps (see [[SiteRoutes]]) and the services on a specification (see
  * [[SpecRoutes]]); more REST of the studio comes later.
  */
abstract class StudioServer extends ZIOAppDefault:

  def config: StudioConfig

  /** More routes of the company - they come before the studio's. */
  def companyRoutes: Routes[Any, Response] = Routes.empty

  def routes: Routes[Any, Response] = companyRoutes ++ SpecRoutes.routes ++ SiteRoutes(config.site).routes

  def run: ZIO[Any, Throwable, Unit] =
    val url = s"http://${config.host}:${config.port}"
    val start =
      for
        _ <- ZIO.logInfo(s"Orch Studio on $url")
        _ <- ZIO.when(SiteSource.orchDocApps().isEmpty):
               ZIO.logWarning("orchescala-orch-doc is not on the classpath - no orch-doc, orch-spec, orch-ops")
        _ <- ZIO.logInfo(s"Documentation: ${config.siteDir.fold("from the classpath (site/)")(_.toString)}")
        _ <- ZIO.logInfo(s"  orch-doc  $url/site/")
        _ <- ZIO.logInfo(s"  orch-spec $url/site/spec/")
        _ <- ZIO.logInfo(s"  orch-ops  $url/site/ops/")
        _ <- Server.serve(routes)
      yield ()
    start.provide(Server.defaultWith(_.binding(config.host, config.port)))

end StudioServer

/** Without a company: `sbt orchStudio/run`, the documentation from `STUDIO_SITE_DIR`. */
object LocalStudioServerApp extends StudioServer:
  lazy val config: StudioConfig = StudioConfig().withEnv()
