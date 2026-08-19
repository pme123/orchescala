package orchescala.dmntester

import munit.FunSuite
import orchescala.domain.*
import orchescala.dmntester.server.DmnTesterServer
import orchescala.dmntester.server.engine.DmnScalaEngine
import orchescala.dmntester.server.runner.{DmnTester, hocon}
import zio.{Runtime, Unsafe}

/** ONE configuration per decision, referencing the DMN of every platform.
  *
  * That is the migration workflow: accept the results of the old version, run
  * the very same test cases against the new one - a difference is a failure.
  */
class MigrationDiffTest extends FunSuite:

  private val resources =
    os.pwd / "04-dmntester-server" / "src" / "test" / "resources"
  private val target = os.pwd / "04-dmntester-server" / "target" / "migration-diff"
  private val engine = DmnScalaEngine()

  private val freePort =
    val socket = new java.net.ServerSocket(0)
    try socket.getLocalPort
    finally socket.close()

  private def run[E, A](body: zio.ZIO[Any, E, A]): Either[E, A] =
    Unsafe.unsafe { implicit u =>
      Runtime.default.unsafe.run(body.either).getOrThrowFiberFailure()
    }

  object CountryRiskDmn extends BpmnDecisionDsl:
    val decisionId = "country-risk"
    val descr = "risk of a country"
    case class In(currentCountry: String, targetCountry: String)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
      lazy val example = In("CH", "DE")
    case class Out(approvalRequired: Boolean)
    object Out:
      given ApiSchema[Out] = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec
      lazy val example = Out(true)
    lazy val example = singleResult(In.example, Out.example)

  trait CompanyDmnTester extends DmnTesterApp:
    override protected def starterConfig: DmnTesterStarterConfig =
      DmnTesterStarterConfig(
        companyName = "acme",
        dmnConfigPaths = Seq(target),
        dmnSources = Map(
          "c7" -> resources / "dmn-sources" / "c7",
          "c8" -> resources / "dmn-sources" / "c8"
        ),
        exposedPort = freePort
      )
    override protected def keepRunning: Boolean = false

  object ProjectDmnTester extends CompanyDmnTester:
    override protected def dmnTesterObjects = Seq(
      CountryRiskDmn.example.testUnit.acceptMissingRules
    )

  override def afterAll(): Unit = DmnTesterServer.stop()

  private lazy val config =
    os.remove.all(target)
    ProjectDmnTester.main(Array.empty)
    hocon.parse(os.read(target / "country-risk.conf")).fold(fail(_), identity)

  test("one config per decision, referencing both DMNs"):
    assertEquals(config.dmnPaths.keySet, Set("c7", "c8"))
    assertEquals(os.list(target).map(_.last).toSet, Set("country-risk.conf"))
    // no redundancy: a path is in the file exactly once
    assertEquals(config.dmnPath, "")
    val written = os.read(target / "country-risk.conf")
    assert(!written.contains("dmnPath="), written)
    assertEquals(written.split("country-risk.dmn").length - 1, 2, written)
    assert(
      config.dmnPaths("c7").endsWith("dmn-sources/c7/country-risk.dmn"),
      config.dmnPaths
    )
    assert(
      config.dmnPaths("c8").endsWith("dmn-sources/c8/country-risk.dmn"),
      config.dmnPaths
    )

  test("a run gives one result per referenced DMN"):
    val results = run(DmnTester(config, engine).runAll()).fold(e => fail(e.msg), identity)
    assertEquals(results.size, 2)
    assertEquals(results.map(_.dmnTables.source), Seq(Some("c7"), Some("c8")))

  test("test cases accepted on c7 are verified on c8"):
    val results = run(DmnTester(config, engine).runAll()).fold(e => fail(e.msg), identity)
    val c7 = results.head
    // accept what C7 does - one set of test cases for the whole config
    val accepted = c7.configWithTestCases(c7.correctRowIndexes)
    assert(accepted.data.testCases.nonEmpty)
    val verified = run(DmnTester(accepted, engine).runAll()).fold(e => fail(e.msg), identity)
    assertEquals(verified.size, 2)
    verified.foreach: result =>
      assertEquals(
        result.evalResults.map(_.status).distinct,
        Seq(EvalStatus.INFO),
        s"${result.dmnTables.source} differs from the accepted results"
      )

  test("a DMN that behaves differently shows up as a failure"):
    val results = run(DmnTester(config, engine).runAll()).fold(e => fail(e.msg), identity)
    val accepted = results.head.configWithTestCases(results.head.correctRowIndexes)
    // pretend the migrated DMN answers differently
    val tampered = accepted.copy(data =
      accepted.data.copy(testCases =
        accepted.data.testCases.map: testCase =>
          testCase.copy(results = testCase.results.map: r =>
            r.copy(outputs = r.outputs.map((k, _) => k -> TesterValue.StringValue("WRONG")))
          )
      )
    )
    val diff = run(DmnTester(tampered, engine).runAll()).fold(e => fail(e.msg), identity)
    diff.foreach: result =>
      assertEquals(result.maxEvalStatus, EvalStatus.ERROR, result.dmnTables.source)

end MigrationDiffTest
