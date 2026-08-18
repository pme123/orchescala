package orchescala.dmntester.server

import orchescala.dmntester.*
import orchescala.dmntester.HandledTesterException.{ConfigException, EvalException}
import orchescala.dmntester.server.engine.{DmnEvalEngine, DmnScalaEngine}
import orchescala.dmntester.server.runner.*
import zio.{IO, UIO, ZIO}


/** Everything the API offers - as ZIO effects. */
class ZDmnService(config: DmnTesterServerConfig):

  /** The one and only engine implementation - see `server/engine`. */
  lazy val engine: DmnEvalEngine = DmnScalaEngine()

  def engineName(): UIO[String] = ZIO.succeed(engine.name)

  def startingApp(): UIO[String] = ZIO.succeed(config.startingApp)

  def basePath(): UIO[String] = ZIO.succeed(os.pwd.toIO.getAbsolutePath)

  def loadConfigPaths(): UIO[Seq[String]] = ZIO.succeed(config.configPaths)

  /** All `*.conf` of a config path - grouped by sub directory, so a project
    * can keep e.g. `dmnConfigs/c7` and `dmnConfigs/c8` next to each other.
    */
  def loadConfigs(path: Seq[String]): IO[ConfigException, Seq[DmnConfigGroup]] =
    for
      groups <- readConfigGroups(path.toList)
      _ <- printLine(
        s"Found ${groups.map(_.configs.size).sum} DmnConfigs in " +
          s"${osPath(path.toList)} (${groups.map(_.name).mkString(", ")})"
      )
    yield groups

  def updateConfig(
      dmnConfig: DmnConfig,
      path: Seq[String]
  ): IO[ConfigException, Seq[DmnConfigGroup]] =
    DmnConfigHandler.write(dmnConfig, path.toList) *> loadConfigs(path)

  def deleteConfig(
      dmnConfig: DmnConfig,
      path: Seq[String]
  ): IO[ConfigException, Seq[DmnConfigGroup]] =
    DmnConfigHandler.delete(dmnConfig, path.toList) *> loadConfigs(path)

  /** per DmnConfig -> Either[EvalException, DmnEvalResult] */
  def runTests(
      dmnConfigs: Seq[DmnConfig]
  ): UIO[Seq[Either[EvalException, DmnEvalResult]]] =
    printLine(s"Let's start - testing against ${engine.name}") *>
      ZIO
        .foreach(dmnConfigs): dmnConfig =>
          DmnTester
            .testDmnTable(dmnConfig, engine)
            .either
            .map:
              case Right(results) => results.map(Right.apply)
              case Left(error)    => Seq(Left(error))
        .map(_.flatten)

  private def readConfigGroups(
      path: List[String]
  ): IO[ConfigException, Seq[DmnConfigGroup]] =
    ZIO
      .attempt(osPath(path))
      .mapError(ex => ConfigException(ex.getMessage))
      .tap(root => printLine(s"Config Path: $root"))
      .flatMap:
        case root if !os.exists(root)   => ZIO.succeed(Seq.empty)
        case root if !os.isDir(root)    =>
          ZIO.fail(
            ConfigException(
              s"Your provided Config Path is not a directory ($root)."
            )
          )
        case root =>
          for
            dirs <- configDirs(root)
            groups <- ZIO.foreach(dirs): dir =>
              for
                files <- configFiles(dir)
                configs <- ZIO.foreach(files)(f => DmnConfigHandler.read(f.toIO))
              yield DmnConfigGroup(
                if dir == root then "" else dir.relativeTo(root).toString,
                configs
              )
          yield groups.filter(_.configs.nonEmpty)

  /** the config path itself and every directory below it */
  private def configDirs(root: os.Path): IO[ConfigException, Seq[os.Path]] =
    ZIO
      .attempt(
        (root +: os.walk(root).filter(os.isDir)).sortBy(_.toString)
      )
      .mapError(ex => ConfigException(ex.getMessage))

  private def configFiles(dir: os.Path): IO[ConfigException, Seq[os.Path]] =
    ZIO
      .attempt(
        os.list(dir)
          .filter(f => os.isFile(f) && f.ext == "conf" && !f.last.startsWith("."))
          .sortBy(_.last)
          .toSeq
      )
      .mapError(ex => ConfigException(ex.getMessage))
end ZDmnService
