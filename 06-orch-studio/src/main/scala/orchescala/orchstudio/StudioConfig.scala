package orchescala.orchstudio

/** The settings of a company's studio.
  *
  * @param port      the port of the studio
  * @param host      the address it listens on - `localhost` while there is no login (PoC)
  * @param siteDir   the company's documentation as a folder (e.g. `00-docs/site`, assembled by
  *                  `prepareDocs`); None: from the classpath (`site/`), where the module `studio`
  *                  of `<company>-orchescala` puts it
  * @param specDir   the company folder of orch-spec - shown on its start screen
  * @param opsDir    the company folder of orch-ops - likewise
  */
final case class StudioConfig(
    port: Int = StudioConfig.defaultPort,
    host: String = "localhost",
    siteDir: Option[os.Path] = None,
    specDir: Option[os.Path] = None,
    opsDir: Option[os.Path] = None
):

  /** The same with what the environment sets: `STUDIO_PORT`, `STUDIO_HOST`, `STUDIO_SITE_DIR`,
    * `STUDIO_SPEC_DIR`, `STUDIO_OPS_DIR` (paths absolute or relative to the working directory).
    */
  def withEnv(env: Map[String, String] = sys.env): StudioConfig =
    def get(name: String)  = env.get(name).map(_.trim).filter(_.nonEmpty)
    def path(name: String) = get(name).map(p => os.Path(p, os.pwd))
    copy(
      port = get("STUDIO_PORT").map(_.toInt).getOrElse(port),
      host = get("STUDIO_HOST").getOrElse(host),
      siteDir = path("STUDIO_SITE_DIR").orElse(siteDir),
      specDir = path("STUDIO_SPEC_DIR").orElse(specDir),
      opsDir = path("STUDIO_OPS_DIR").orElse(opsDir)
    )

  def site: Site =
    Site(
      data = siteDir.map(SiteSource.Folder(_)).getOrElse(SiteSource.Classpath("site/")),
      extras = SiteSource.folderHints(specDir.map("spec" -> _).toSeq ++ opsDir.map("ops" -> _).toSeq)
    )

end StudioConfig

object StudioConfig:
  /** Next to the gateways of the demo (8889) and the preview (8890); the stack studio/ maps it to 8881. */
  val defaultPort = 8880
