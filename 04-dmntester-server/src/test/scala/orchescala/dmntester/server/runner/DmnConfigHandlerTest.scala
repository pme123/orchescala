package orchescala.dmntester.server.runner

import munit.FunSuite
import orchescala.dmntester.*
import orchescala.dmntester.TesterValue.*

class DmnConfigHandlerTest extends FunSuite:

  private val configPaths = Seq(
    os.pwd / "04-dmntester-server" / "src" / "test" / "resources" / "dmn-config" / "c7",
    os.pwd / "04-dmntester-server" / "src" / "test" / "resources" / "dmn-config" / "c8"
  )

  /** exactly the shape a project (valiant-documents) has on disk today */
  private val projectConfig =
    """acceptMissingRules="true"
      |data {
      |    inputs=[
      |        {
      |            id="41748"
      |            key=docId
      |            "nullValue"="false"
      |            values=[
      |                Basisvertrag,
      |                Execution-Only-Vertrag,
      |                QR-Rechnung
      |            ]
      |        }
      |    ]
      |    testCases=[]
      |    variables=[]
      |}
      |decisionId=valiant-documents-documentInfo
      |dmnPath=[
      |    c8,
      |    src,
      |    main,
      |    resources,
      |    "documents-documentInfo.dmn"
      |]
      |isActive="false"
      |testUnit="true"
      |""".stripMargin

  test("read a DmnConfig as a project has it on disk"):
    val config = hocon.parse(projectConfig).fold(fail(_), identity)
    assertEquals(config.decisionId, "valiant-documents-documentInfo")
    assertEquals(config.acceptMissingRules, true)
    assertEquals(config.testUnit, true)
    assertEquals(config.isActive, false)
    assertEquals(config.dmnPathStr, "c8/src/main/resources/documents-documentInfo.dmn")
    assertEquals(config.dmnConfigPathStr, "valiant-documents-documentInfo.conf")
    val input = config.data.inputs.head
    assertEquals(input.key, "docId")
    assertEquals(input.id, Some(41748))
    assertEquals(input.nullValue, false)
    assertEquals(
      input.values,
      List[TesterValue](
        StringValue("Basisvertrag"),
        StringValue("Execution-Only-Vertrag"),
        StringValue("QR-Rechnung")
      )
    )

  test("a project config survives write -> read unchanged"):
    val config = hocon.parse(projectConfig).fold(fail(_), identity)
    val reread = hocon.parse(hocon.render(config)).fold(fail(_), identity)
    assertEquals(reread, config)

  test("testUnit = false gives the -INT config file name"):
    val config = hocon.parse(projectConfig).fold(fail(_), identity).copy(testUnit = false)
    assertEquals(config.dmnConfigPathStr, "valiant-documents-documentInfo-INT.conf")

  test("dates, numbers, booleans and null survive the round trip"):
    val config = DmnConfig(
      decisionId = "all-types",
      data = TesterData(
        inputs = List(
          TesterInput("date", values = List(DateValue("2021-12-23T00:00:00"))),
          TesterInput("number", values = List(NumberValue(12), NumberValue(12.5))),
          TesterInput("flag", values = List(BooleanValue(true))),
          TesterInput("maybe", nullValue = true, values = List(NullValue))
        ),
        testCases = List(
          TestCase(
            Map("date" -> DateValue("2021-12-23T00:00:00")),
            List(TestResult(1, Map("out" -> StringValue("yes"))))
          )
        )
      ),
      dmnPath = List("dmn", "c7", "dates.dmn")
    )
    val reread = hocon.parse(hocon.render(config)).fold(fail(_), identity)
    assertEquals(reread, config)

  test("every bundled example config can be read"):
    val files = configPaths.flatMap(p => os.list(p).filter(_.ext == "conf"))
    assert(files.nonEmpty)
    files.foreach: file =>
      val config = hocon
        .parse(os.read(file))
        .fold(msg => fail(s"$file: $msg"), identity)
      assertEquals(config.decisionIdError, None, s"$file")
      assertEquals(config.dmnPathError, None, s"$file")

end DmnConfigHandlerTest
