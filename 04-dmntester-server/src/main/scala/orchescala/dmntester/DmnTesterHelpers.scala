package orchescala.dmntester

import sttp.client3.*

trait DmnTesterHelpers:
  protected def starterConfig: DmnTesterStarterConfig

  /** `starterConfig` is a `def` a project may compute - evaluate it once, so
    * the server, the writer and the browser all talk about the same tester.
    */
  protected final lazy val testerConfig: DmnTesterStarterConfig = starterConfig

  protected def projectBasePath: os.Path = os.pwd
  private lazy val exposedPort: Int = testerConfig.exposedPort
  protected lazy val client: SimpleHttpClient = SimpleHttpClient()
  protected lazy val apiUrl = s"http://localhost:$exposedPort/api"
  protected lazy val infoUrl = s"http://localhost:$exposedPort/info"

  protected case class DmnTesterStarterConfig(
      companyName: String,
      // path to where the configs should be created in
      dmnConfigPaths: Seq[os.Path] = Seq(
        projectBasePath / "03-dmn" / "src" / "main" / "resources" / "dmnConfigs"
      ),
      // paths where the DMNs are (could be different places)
      dmnPaths: Seq[os.Path] = Seq(
        projectBasePath / "src" / "main" / "resources"
      ),
      /** Named DMN sources - use this if a project has DMNs of more than one
        * platform, e.g.
        * {{{
        * dmnSources = Map(
        *   "c7" -> projectBasePath / "src" / "main" / "resources" / "camunda",
        *   "c8" -> projectBasePath / "c8" / "src" / "main" / "resources"
        * )
        * }}}
        * The configurations of a source are written into the sub directory of
        * the same name (`dmnConfigs/c7`, `dmnConfigs/c8`), and the tester shows
        * one group per sub directory - one tester for the whole project.
        */
      dmnSources: Map[String, os.Path] = Map.empty,
      // the port the DMN Tester is started - e.g. http://localhost:8883
      exposedPort: Int = 8883,
      // the DMN Tester runs in this JVM now - these two are only kept so that
      // existing projects keep compiling.
      @deprecated("the tester is started in-process, there is no container", "0.6.0")
      containerName: String = "dmn-tester",
      @deprecated("the tester is started in-process, there is no image", "0.6.0")
      imageVersion: String = "latest"
  ):
    /** all DMN sources of the project - named ones first, `dmnPaths` as the
      * unnamed fallback for projects with only one platform.
      */
    lazy val sources: Seq[(Option[String], os.Path)] =
      if dmnSources.nonEmpty then
        dmnSources.toSeq.sortBy(_._1).map((name, path) => Some(name) -> path)
      else dmnPaths.map(None -> _)

    /** the DMN source with this name - falls back to the first one */
    def dmnSource(name: Option[String]): os.Path =
      name
        .flatMap(dmnSources.get)
        .orElse(sources.headOption.map(_._2))
        .getOrElse(dmnPaths.head)

    /** the sub directory the configurations of a source are written to */
    def configSubDir(name: Option[String]): Option[String] =
      name.filter(dmnSources.contains)

    /** the config paths as the server takes them - relative to the directory
      * the project runs in, so they stay readable in the UI.
      */
    lazy val configPathsForServer: Seq[String] =
      dmnConfigPaths.map: path =>
        if path.startsWith(projectBasePath) then
          path.relativeTo(projectBasePath).toString
        else path.toString
  end DmnTesterStarterConfig

end DmnTesterHelpers
