package orchescala.dmntester

import munit.FunSuite
import orchescala.domain.*
import orchescala.dmntester.server.DmnTesterServer

/** Both DSL styles must work: `createDmnConfigs(...)` in the body of the object
  * (as projects have written it so far) and the `dmnTesterObjects` list.
  */
class DmnTesterAppStylesTest extends FunSuite:

  private val target = os.pwd / "04-dmntester-server" / "target" / "styles-test"

  private def freePort =
    val socket = new java.net.ServerSocket(0)
    try socket.getLocalPort
    finally socket.close()

  trait CompanyDmnTester extends DmnTesterApp:
    override protected def starterConfig: DmnTesterStarterConfig =
      DmnTesterStarterConfig(
        companyName = "acme",
        dmnConfigPaths = Seq(target / configDir),
        dmnSources = Seq(
          DmnSource(
            os.pwd / "04-dmntester-server" / "src" / "test" / "resources" / "dmn" / "c7"
          )
        ),
        exposedPort = port
      )
    override protected def keepRunning: Boolean = false
    override protected def dmnPathOf(dmnName: String, source: Option[String]): os.Path =
      starterConfig.dmnSources.head.path / s"$dmnName.dmn"
    protected def configDir: String
    protected def port: Int

  /** the style projects use today - `createDmnConfigs` in the body */
  object OldStyleTester extends CompanyDmnTester:
    protected val configDir = "old-style"
    protected val port = freePort

    createDmnConfigs(
      DecisionDmn.init("country-risk").testUnit
        .acceptMissingRules,
      // inTestMode: the config is NOT regenerated
      DecisionDmn.init("collect-numbers").testUnit
        .inTestMode
    )

  /** the new style - a list of what shall be tested */
  object NewStyleTester extends CompanyDmnTester:
    protected val configDir = "new-style"
    protected val port = freePort

    override protected def dmnTesterObjects: Seq[DmnTesterObject[?]] = Seq(
      DecisionDmn.init("country-risk").testUnit.acceptMissingRules,
      DecisionDmn.init("collect-numbers").testUnit.inTestMode
    )

  override def afterAll(): Unit = DmnTesterServer.stop()

  test("createDmnConfigs in the body writes the configs and starts the tester"):
    os.remove.all(target / "old-style")
    OldStyleTester.main(Array.empty)
    val written = os.list(target / "old-style").map(_.last).toSet
    assertEquals(written, Set("country-risk.conf"), "inTestMode must not be written")
    val config = server.runner.hocon
      .parse(os.read(target / "old-style" / "country-risk.conf"))
      .fold(fail(_), identity)
    assertEquals(config.decisionId, "country-risk")
    assertEquals(config.acceptMissingRules, true)
    assertEquals(config.testUnit, true)
    assert(DmnTesterServer.isRunning)

  test("the dmnTesterObjects list writes exactly the same"):
    DmnTesterServer.stop()
    os.remove.all(target / "new-style")
    NewStyleTester.main(Array.empty)
    assertEquals(
      os.list(target / "new-style").map(_.last).toSet,
      Set("country-risk.conf")
    )
    assertEquals(
      os.read(target / "new-style" / "country-risk.conf"),
      os.read(target / "old-style" / "country-risk.conf")
    )

end DmnTesterAppStylesTest
