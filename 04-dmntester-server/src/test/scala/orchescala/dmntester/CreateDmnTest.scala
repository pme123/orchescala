package orchescala.dmntester

import munit.FunSuite
import orchescala.domain.*
import orchescala.dmntester.server.DmnTesterServer
import orchescala.dmntester.server.engine.{DmnEvalEngine, DmnScalaEngine}

/** `.createC7Dmn` / `.createC8Dmn`: a decision that has no DMN yet gets one -
  * created from its domain object, ready to be evaluated and to be edited in
  * the Camunda Modeler.
  */
class CreateDmnTest extends FunSuite:

  private val target = os.pwd / "04-dmntester-server" / "target" / "createDmn"
  private val c7Source = target / "dmn" / "c7"
  private val c8Source = target / "dmn" / "c8"
  private val configs = target / "dmnConfigs"

  private val freePort =
    val socket = new java.net.ServerSocket(0)
    try socket.getLocalPort
    finally socket.close()

  /** no DMN yet - it is created from this */
  object DocumentInfoDmn extends BpmnDecisionDsl:
    val decisionId = "acme-documentInfo"
    val descr = "the type of a document"
    case class In(docId: String = "Basisvertrag", isSigned: Boolean = true)
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
    case class Out(docType: String = "contract", priority: Int = 3)
    object Out:
      given ApiSchema[Out] = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec
    lazy val example = singleResult(In(), Out())

  /** the same for Camunda 8 - it goes to the `c8` source */
  object StaticDocumentsDmn extends BpmnDecisionDsl:
    val decisionId = "acme-staticDocuments"
    val descr = "the documents of a contract"
    case class In(docId: String = "Basisvertrag")
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
    lazy val example = collectEntries(In(), CollectEntries(Seq("Basisvertrag")))

  /** a DMN of its own name - `.dmnPath` wins over the default */
  object OwnNameDmn extends BpmnDecisionDsl:
    val decisionId = "acme-ownName"
    val descr = "in a DMN of another name"
    case class In(docId: String = "Basisvertrag")
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
    lazy val example = singleEntry(In(), "contract")

  /** this one HAS a DMN - it must not be touched */
  object ExistingDmn extends BpmnDecisionDsl:
    val decisionId = "acme-existing"
    val descr = "already modelled"
    case class In(a: String = "x")
    object In:
      given ApiSchema[In] = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec
    lazy val example = singleEntry(In(), "y")

  trait CompanyDmnTester extends DmnTesterApp:
    override protected def starterConfig: DmnTesterStarterConfig =
      DmnTesterStarterConfig(
        companyName = "acme",
        dmnConfigPaths = Seq(configs),
        dmnSources = Map("c7" -> c7Source, "c8" -> c8Source),
        exposedPort = freePort
      )
    override protected def keepRunning: Boolean = false

  object ProjectDmnTester extends CompanyDmnTester:
    override protected def dmnTesterObjects = Seq(
      DocumentInfoDmn.example.testUnit
        .testValues(_.docId, "Basisvertrag", "QR-Rechnung")
        .createC7Dmn,
      StaticDocumentsDmn.example.testUnit.createC8Dmn,
      OwnNameDmn.example.testUnit.dmnPath("documentDecisions").createC7Dmn,
      ExistingDmn.example.testUnit.createC7Dmn
    )

  private val existingDmn = os.read(
    os.pwd / "04-dmntester-server" / "src" / "test" / "resources" / "dmn" / "c7" / "numbers.dmn"
  )

  override def afterAll(): Unit = DmnTesterServer.stop()

  private lazy val output =
    os.remove.all(target)
    os.write(c7Source / "existing.dmn", existingDmn, createFolders = true)
    os.makeDir.all(c8Source)
    val out = java.io.ByteArrayOutputStream()
    Console.withOut(out)(ProjectDmnTester.main(Array.empty))
    out.toString

  private lazy val engine: DmnEvalEngine = DmnScalaEngine()

  private def parse(dmnFile: os.Path) =
    val stream = os.read.inputStream(dmnFile)
    try engine.parse(stream, dmnFile.last).fold(e => fail(e.msg), identity)
    finally stream.close()

  test("a decision without a DMN gets one - in the source of the flavor"):
    assert(output.contains("Created the C7 DMN of 'acme-documentInfo'"), output)
    assert(os.exists(c7Source / "documentInfo.dmn"), os.list(c7Source))
    assert(os.exists(c8Source / "staticDocuments.dmn"), os.list(c8Source))

  test("a DMN of its own name is created there"):
    assert(os.exists(c7Source / "documentDecisions.dmn"), os.list(c7Source))
    assertEquals(
      parse(c7Source / "documentDecisions.dmn").decisionIds,
      Seq("acme-ownName")
    )

  test("an existing DMN is never overwritten"):
    assert(output.contains("The DMN of 'acme-existing' exists already"), output)
    assertEquals(os.read(c7Source / "existing.dmn"), existingDmn)

  test("the created DMN is a valid DMN - the engine parses it"):
    assertEquals(parse(c7Source / "documentInfo.dmn").decisionIds, Seq("acme-documentInfo"))

  test("the table is the one of the domain object"):
    val model = parse(c7Source / "documentInfo.dmn")
    val table = engine
      .decisionTables(model, "acme-documentInfo", testUnit = true)
      .fold(e => fail(e.msg), identity)
      .head
    assertEquals(table.hitPolicy, HitPolicy.UNIQUE)
    assertEquals(table.inputCols.map(_.feelExprText), Seq("docId", "isSigned"))
    assertEquals(table.outputCols.map(_.name), Seq("docType", "priority"))
    assertEquals(table.ruleRows.size, 1)

  test("the created DMN can be evaluated - it returns the example"):
    val model = parse(c7Source / "documentInfo.dmn")
    val results = engine
      .evalRow(
        model,
        "acme-documentInfo",
        testUnit = true,
        Map("docId" -> "QR-Rechnung", "isSigned" -> false)
      )
      .fold(e => fail(e.msg), identity)
    assertEquals(results.head.maybeError, None)
    assertEquals(
      results.head.matchedRules.map(_.outputs),
      Seq(Seq("docType" -> "contract", "priority" -> "3"))
    )

  test("a Seq as result is a COLLECT table"):
    val model = parse(c8Source / "staticDocuments.dmn")
    val table = engine
      .decisionTables(model, "acme-staticDocuments", testUnit = true)
      .fold(e => fail(e.msg), identity)
      .head
    assertEquals(table.hitPolicy, HitPolicy.COLLECT)

  test("the created DMN is tested like every other one"):
    assertEquals(
      os.list(configs).map(_.last).toSet,
      Set(
        "acme-documentInfo.conf",
        "acme-staticDocuments.conf",
        "acme-ownName.conf",
        "acme-existing.conf"
      )
    )

end CreateDmnTest
