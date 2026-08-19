package orchescala.dmntester

import sttp.client3.*

/** A place where DMNs of this project are.
  *
  * Give a source a name if the project has DMNs of more than one platform -
  * the name is what the tester shows for a DMN and what `.from("c8")` in the
  * DSL refers to.
  */
case class DmnSource(name: Option[String], path: os.Path)

object DmnSource:
  def apply(path: os.Path): DmnSource               = DmnSource(None, path)
  def apply(name: String, path: os.Path): DmnSource = DmnSource(Some(name), path)

trait DmnTesterHelpers:
  protected def starterConfig: DmnTesterStarterConfig

  /** `starterConfig` is a `def` a project may compute - evaluate it once, so
    * the server, the writer and the browser all talk about the same tester.
    */
  protected final lazy val testerConfig: DmnTesterStarterConfig = starterConfig

  protected def projectBasePath: os.Path = os.pwd

  // so a project can say `DmnSource(...)` without an extra import
  protected type DmnSource = orchescala.dmntester.DmnSource
  protected val DmnSource: orchescala.dmntester.DmnSource.type =
    orchescala.dmntester.DmnSource
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
      /** where the DMNs of this project are - one entry per place.
        *
        * Name the sources if the project has DMNs of more than one platform:
        * {{{
        * dmnSources = Seq(
        *   DmnSource("c7", projectBasePath / "src" / "main" / "resources" / "camunda"),
        *   DmnSource("c8", projectBasePath / "c8" / "src" / "main" / "resources")
        * )
        * }}}
        * A decision is looked up in EVERY source, and its configuration
        * references every DMN it was found in - so one set of test cases runs
        * against all versions of a DMN, which is what you want in a migration.
        */
      dmnSources: Seq[DmnSource] = Seq(
        DmnSource(projectBasePath / "src" / "main" / "resources")
      ),
      // the port the DMN Tester is started - e.g. http://localhost:8883
      exposedPort: Int = 8883,
      // the DMN Tester runs in this JVM now - these two are only kept so that
      // existing projects keep compiling.
      @deprecated("the tester is started in-process, there is no container", "0.6.0")
      containerName: String = "dmn-tester",
      @deprecated("the tester is started in-process, there is no image", "0.6.0")
      imageVersion: String = "latest"
  ):
    /** all DMN sources of the project, named ones in a stable order */
    lazy val sources: Seq[DmnSource] = dmnSources.sortBy(_.name)

    /** the DMN source with this name - falls back to the first one */
    def dmnSource(name: Option[String]): os.Path =
      name
        .flatMap(n => sources.find(_.name.contains(n)))
        .orElse(sources.headOption)
        .map(_.path)
        .getOrElse(
          sys.error(
            "There is no DMN source - set `dmnSources` in your DmnTesterStarterConfig."
          )
        )

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
