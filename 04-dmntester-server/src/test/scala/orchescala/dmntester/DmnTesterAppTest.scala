package orchescala.dmntester

import munit.FunSuite
import orchescala.domain.*
import orchescala.dmntester.server.DmnTesterServer
import scala.language.implicitConversions

/** Shows how a company and a project use the tester - and proves that the
  * whole chain works: DSL -> DmnConfig -> written file -> running tester.
  */
class DmnTesterAppTest extends FunSuite:

  private val target = os.pwd / "04-dmntester-server" / "target" / "app-test"

  private val freePort =
    val socket = new java.net.ServerSocket(0)
    try socket.getLocalPort
    finally socket.close()

  /** ---- company level (e.g. valiant-orchescala-dmn) -------------------- */
  trait CompanyDmnTester extends DmnTesterApp:
    override protected def starterConfig: DmnTesterStarterConfig =
      DmnTesterStarterConfig(
        companyName = "acme",
        dmnConfigPaths = Seq(target),
        dmnSources = Seq(
          DmnSource(
            os.pwd / "04-dmntester-server" / "src" / "test" / "resources" / "dmn" / "c8"
          )
        ),
        exposedPort = freePort
      )
    // the tester should not block the test
    override protected def keepRunning: Boolean = false

  /** ---- project level --------------------------------------------------- */
  object ProjectDmnTester extends CompanyDmnTester:
    override protected def dmnPathOf(dmnName: String, source: Option[String]): os.Path =
      starterConfig.dmnSources.head.path / s"$dmnName.dmn"

    // this is where a project describes its DMNs - with the DSL
    override protected def dmnTesterObjects: Seq[DmnTesterObject[?]] = Seq(
      DecisionDmn.init("c8-dish").testUnit
    )

    def starterConfigForTest: DmnTesterStarterConfig = starterConfig

  override def afterAll(): Unit = DmnTesterServer.stop()

  test("a project app starts the tester and writes its configurations"):
    os.remove.all(target)
    ProjectDmnTester.main(Array.empty)
    assert(DmnTesterServer.isRunning, "the tester should be running")
    assert(os.exists(target), s"$target should have been created")

  test("the company level decides where the configs and DMNs live"):
    val config = ProjectDmnTester.starterConfigForTest
    assertEquals(config.companyName, "acme")
    assertEquals(config.exposedPort, freePort)
    assertEquals(
      config.configPathsForServer,
      Seq("04-dmntester-server/target/app-test")
    )

end DmnTesterAppTest
