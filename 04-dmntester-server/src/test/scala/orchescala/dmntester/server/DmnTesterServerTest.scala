package orchescala.dmntester.server

import io.circe.parser.decode
import io.circe.syntax.*
import munit.FunSuite
import orchescala.dmntester.*
import orchescala.dmntester.HandledTesterException.EvalException
import sttp.client3.*

/** The tester as a project starts it: in this JVM, no Docker. */
class DmnTesterServerTest extends FunSuite:

  // a free port - the machine may well run other testers already
  private val port =
    val socket = new java.net.ServerSocket(0)
    try socket.getLocalPort
    finally socket.close()
  private val url = s"http://localhost:$port"
  private val configPath = "04-dmntester-server/src/test/resources/dmn-config/c8"
  private val client = SimpleHttpClient()

  override def beforeAll(): Unit =
    DmnTesterServer.start(
      DmnTesterServerConfig(
        configPaths = Seq(
          "04-dmntester-server/src/test/resources/dmn-config/c7",
          configPath
        ),
        port = port,
        startingApp = "orchescala.dmntester.server.DmnTesterServerTest"
      )
    )

  override def afterAll(): Unit = DmnTesterServer.stop()

  private def get(path: String): String =
    client.send(basicRequest.get(uri"${url + path}").response(asStringAlways)).body

  test("/info tells which app started the tester"):
    assertEquals(get("/info"), "orchescala.dmntester.server.DmnTesterServerTest")

  test("the configured paths are offered"):
    val paths = decode[Seq[String]](get("/api/configPaths")).fold(e => fail(e.toString), identity)
    assertEquals(paths.size, 2)
    assert(paths.exists(_.endsWith("c8")), paths)

  test("the configs of a path are served - grouped by sub directory"):
    val groups = decode[Seq[DmnConfigGroup]](get(s"/api/dmnConfigs?path=$configPath"))
      .fold(e => fail(e.toString), identity)
    assertEquals(groups.map(_.path), Seq(""))
    assertEquals(groups.head.configs.map(_.decisionId), Seq("c8-dish"))

  test("running the tests over http gives the full multi-table result"):
    val configs = decode[Seq[DmnConfigGroup]](get(s"/api/dmnConfigs?path=$configPath"))
      .fold(e => fail(e.toString), identity)
      .flatMap(_.configs)
    val body = client
      .send(
        basicRequest
          .contentType("application/json")
          .body(configs.asJson.noSpaces)
          .post(uri"${url + "/api/runDmnTests"}")
          .response(asStringAlways)
      )
      .body
    val results = decode[Seq[Either[EvalException, DmnEvalResult]]](body)
      .fold(e => fail(s"$e\n$body"), identity)
    assertEquals(results.size, 1)
    val result = results.head.getOrElse(fail("expected a result"))
    assertEquals(result.dmnTables.mainTable.decisionId, "c8-dish")
    assertEquals(result.evalResults.size, 6)
    assertEquals(result.outputKeys, Seq("desiredDish"))

  test("a DmnConfig can be written back - this is what the DSL does"):
    val target = os.pwd / "04-dmntester-server" / "target" / "server-test-configs"
    os.remove.all(target)
    val config = DmnConfig(
      decisionId = "written-by-the-dsl",
      data = TesterData(inputs = List(TesterInput("season", values = List(TesterValue.StringValue("Fall"))))),
      dmnPath = "04-dmntester-server/src/test/resources/dmn/c8/c8-dish.dmn"
    )
    val path = target.relativeTo(os.pwd).toString
    val response = client.send(
      basicRequest
        .contentType("application/json")
        .body(config.asJson.noSpaces)
        .put(uri"${s"$url/api/dmnConfig?path=$path"}")
        .response(asStringAlways)
    )
    assertEquals(response.code.code, 200, response.body)
    assert(os.exists(target / "written-by-the-dsl.conf"), os.list(target))
    val reread = decode[Seq[DmnConfigGroup]](response.body)
      .fold(e => fail(e.toString), identity)
      .flatMap(_.configs)
    assertEquals(reread.map(_.decisionId), Seq("written-by-the-dsl"))

  test("the UI is served from the jar - or says so if it was not built"):
    val response = client.send(basicRequest.get(uri"${url + "/"}").response(asStringAlways))
    assert(
      response.code.code == 200 || response.body.contains("Not found"),
      s"${response.code}: ${response.body.take(200)}"
    )

end DmnTesterServerTest
