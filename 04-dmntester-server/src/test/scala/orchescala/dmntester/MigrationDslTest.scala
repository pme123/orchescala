package orchescala.dmntester

import munit.FunSuite
import orchescala.domain.*
import orchescala.dmntester.server.DmnTesterServer

/** ONE description covers all versions of a DMN: the tester looks the decision
  * up in every source and writes a configuration per source it finds it in.
  */
class MigrationDslTest extends FunSuite:

  private val resources =
    os.pwd / "04-dmntester-server" / "src" / "test" / "resources"
  private val target = os.pwd / "04-dmntester-server" / "target" / "migration"

  private val freePort =
    val socket = new java.net.ServerSocket(0)
    try socket.getLocalPort
    finally socket.close()

  /** exists in c7 AND c8 - the migration case */
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

  /** exists only in c8 */
  object DishDmn extends BpmnDecisionDsl:
    val decisionId = "c8-dish"
    val descr = "what to cook"
    case class In(season: String, guestCount: Int)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
      lazy val example = In("Winter", 4)
    case class Out(desiredDish: String)
    object Out:
      given ApiSchema[Out] = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec
      lazy val example = Out("Roastbeef")
    lazy val example = singleResult(In.example, Out.example)

  /** exists nowhere - must be reported, not guessed */
  object GoneDmn extends BpmnDecisionDsl:
    val decisionId = "not-there"
    val descr = "removed decision"
    case class In(a: String)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
      lazy val example = In("x")
    case class Out(b: String)
    object Out:
      given ApiSchema[Out] = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec
      lazy val example = Out("y")
    lazy val example = singleResult(In.example, Out.example)

  trait CompanyDmnTester extends DmnTesterApp:
    override protected def starterConfig: DmnTesterStarterConfig =
      DmnTesterStarterConfig(
        companyName = "acme",
        dmnConfigPaths = Seq(target),
        dmnSources = Seq(
          DmnSource("c7", resources / "dmn-sources" / "c7"),
          DmnSource("c8", resources / "dmn-sources" / "c8")
        ),
        exposedPort = freePort
      )
    override protected def keepRunning: Boolean = false

  object ProjectDmnTester extends CompanyDmnTester:
    override protected def dmnTesterObjects = Seq(
      // one description - covers c7 and c8
      CountryRiskDmn.example.testUnit.acceptMissingRules,
      DishDmn.example.testUnit,
      GoneDmn.example.testUnit
    )

  override def afterAll(): Unit = DmnTesterServer.stop()

  private lazy val output =
    os.remove.all(target)
    val out = java.io.ByteArrayOutputStream()
    Console.withOut(out)(ProjectDmnTester.main(Array.empty))
    out.toString

  test("one description writes ONE config that references every version"):
    assert(output.nonEmpty)
    assertEquals(
      os.list(target).map(_.last).toSet,
      Set("country-risk.conf", "c8-dish.conf")
    )
    val countryRisk = server.runner.hocon
      .parse(os.read(target / "country-risk.conf")).fold(fail(_), identity)
    assertEquals(countryRisk.dmnPaths.keySet, Set("c7", "c8"))
    assert(countryRisk.acceptMissingRules)

  test("a decision of only one platform references only that one"):
    val dish = server.runner.hocon
      .parse(os.read(target / "c8-dish.conf")).fold(fail(_), identity)
    assertEquals(dish.dmnPaths.keySet, Set("c8"))
    assert(
      dish.dmnPaths("c8").endsWith("dmn-sources/c8/c8-dish.dmn"),
      dish.dmnPaths
    )

  test("a decision without any DMN is reported"):
    assert(output.contains("There is no DMN 'not-there.dmn'"), output)
    assert(output.contains("is not tested"), output)

  test("a DMN that no decision covers is reported"):
    assert(output.contains("have no test configuration"), output)
    assert(output.contains("numbers.dmn"), output)

end MigrationDslTest
