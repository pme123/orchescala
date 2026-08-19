package orchescala.dmntester

import munit.FunSuite
import orchescala.domain.*
import orchescala.dmntester.server.DmnTesterServer

/** The DSL exactly as a project writes it - including `.testValues(_.field, …)`
  * on a real `DecisionDmn` and `createDmnConfigs` in the body of the object.
  */
class ProjectStyleDslTest extends FunSuite:

  private val target = os.pwd / "04-dmntester-server" / "target" / "project-style"

  // --- a project's domain ------------------------------------------------
  object DocumentInfoDmn extends BpmnDecisionDsl:
    val decisionId = "country-risk"
    val descr = "Provides information to a dynamic document."

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
  end DocumentInfoDmn

  object StaticDocumentsDmn extends BpmnDecisionDsl:
    val decisionId = "collect-numbers"
    val descr = "Static documents."

    case class In(number: Int)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
      lazy val example = In(1)

    case class Out(result: Int)
    object Out:
      given ApiSchema[Out] = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec
      lazy val example = Out(1)

    lazy val example = singleResult(In.example, Out.example)
  end StaticDocumentsDmn

  /** an Input that is not a simple value, but an object - the DMN addresses its
    * fields (`selectedFond.percentage`)
    */
  object SelectedFondDmn extends BpmnDecisionDsl:
    val decisionId = "selected-fond"
    val descr = "The share of a selected fond."

    case class SelectedFond(id: Long, percentage: Int)
    object SelectedFond:
      given ApiSchema[SelectedFond] = deriveApiSchema
      given InOutCodec[SelectedFond] = deriveInOutCodec

    case class In(selectedFond: SelectedFond)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
      lazy val example = In(SelectedFond(id = 11393215, percentage = 50))

    lazy val example = singleEntry(In.example, "big")
  end SelectedFondDmn

  // --- company level -----------------------------------------------------
  private val freePort =
    val socket = new java.net.ServerSocket(0)
    try socket.getLocalPort
    finally socket.close()

  trait CompanyDmnTester extends DmnTesterApp:
    override protected def starterConfig: DmnTesterStarterConfig =
      DmnTesterStarterConfig(
        companyName = "valiant",
        dmnConfigPaths = Seq(target),
        dmnSources = Seq(
          DmnSource(
            os.pwd / "04-dmntester-server" / "src" / "test" / "resources" / "dmn" / "c7"
          )
        ),
        exposedPort = freePort
      )
    override protected def keepRunning: Boolean = false
    override protected def dmnPathOf(dmnName: String, source: Option[String]): os.Path =
      starterConfig.dmnSources.head.path / s"$dmnName.dmn"

  // --- project level - the code of this ticket ---------------------------
  object ProjectDmnTester extends CompanyDmnTester:

    createDmnConfigs(
      DocumentInfoDmn.example.testUnit
        .testValues(
          _.currentCountry,
          "CH",
          "DE",
          "OTHER"
        )
        .acceptMissingRules
      , // .inTestMode,
      StaticDocumentsDmn.example.testUnit
        .testValues(
          _.number,
          1,
          2,
          3
        )
        .inTestMode,
      SelectedFondDmn.example.testUnit
        .testValues(
          _.selectedFond,
          SelectedFondDmn.SelectedFond(id = 11393215, percentage = 10),
          SelectedFondDmn.SelectedFond(id = 11393215, percentage = 50)
        )
    )
  end ProjectDmnTester

  override def afterAll(): Unit = DmnTesterServer.stop()

  test("the project DSL writes the configs and starts the tester"):
    os.remove.all(target)
    ProjectDmnTester.main(Array.empty)
    assertEquals(
      os.list(target).map(_.last).toSet,
      Set("country-risk.conf", "selected-fond.conf"),
      "inTestMode keeps the hand maintained config"
    )
    val config = server.runner.hocon
      .parse(os.read(target / "country-risk.conf"))
      .fold(fail(_), identity)
    assertEquals(config.decisionId, "country-risk")
    assertEquals(config.acceptMissingRules, true)
    assertEquals(config.testUnit, true)
    // testValues of the DSL land in the config, the other input keeps its example
    val inputs = config.data.inputs.map(i => i.key -> i.valuesAsString).toMap
    assertEquals(inputs("currentCountry"), "CH, DE, OTHER")
    assertEquals(inputs("targetCountry"), "DE")
    assert(DmnTesterServer.isRunning)

  test("an object Input keeps its fields - as the example and as testValues"):
    val config = server.runner.hocon
      .parse(os.read(target / "selected-fond.conf"))
      .fold(fail(_), identity)
    assertEquals(
      config.data.inputs.map(i => i.key -> i.valuesAsString).toMap,
      Map(
        "selectedFond" ->
          "{id: 11393215, percentage: 10}, {id: 11393215, percentage: 50}"
      )
    )

end ProjectStyleDslTest
