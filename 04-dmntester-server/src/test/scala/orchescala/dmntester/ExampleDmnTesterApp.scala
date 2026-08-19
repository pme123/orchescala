package orchescala.dmntester

/** Starts the DMN Tester with the example DMNs of this repository - the fastest
  * way to see it, and the same code a project writes.
  *
  * {{{
  * sbt dmnTester            # alias for the line below
  * sbt "dmnTesterServer/Test/runMain orchescala.dmntester.ExampleDmnTesterApp"
  * }}}
  *
  * Then open http://localhost:8883 - the dropdown offers the C7 and the C8
  * examples. Stop it with Ctrl-C.
  *
  * The UI must be built once: `cd 04-dmntester-client && npm ci && npm run build`
  */
object ExampleDmnTesterApp extends DmnTesterApp:

  private val examples =
    os.pwd / "04-dmntester-server" / "src" / "test" / "resources"

  override protected def starterConfig: DmnTesterStarterConfig =
    DmnTesterStarterConfig(
      companyName = "orchescala",
      // ONE config path - the tester shows a group per sub directory (c7/c8)
      dmnConfigPaths = Seq(examples / "dmn-config-migration"),
      dmnSources = Seq(
        DmnSource("c7", examples / "dmn" / "c7"),
        DmnSource("c8", examples / "dmn" / "c8")
      )
    )

  /** The example configurations are already in the repository, so there is
    * nothing to generate here. A project lists its decisions here - once per
    * decision, no matter in how many sources (c7/c8) the DMN exists.
    */
  override protected def dmnTesterObjects: Seq[DmnTesterObject[?]] = Seq.empty

end ExampleDmnTesterApp
