package orchescala.engine.config

import com.sun.net.httpserver.HttpServer
import munit.FunSuite

import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress

/** `Artifactory.versionLookup` against a local stand-in of Artifactory's search API - curl as in
  * the helper, no network.
  */
class VersionLookupTest extends FunSuite:

  private var server: HttpServer = null

  override def beforeAll(): Unit =
    server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/artifactory/api/search/latestVersion",
      exchange =>
        val query           = exchange.getRequestURI.getRawQuery
        // the credentials of the curl config (stdin) arrive as basic auth
        val authenticated   = Option(exchange.getRequestHeaders.getFirst("Authorization")).exists(_.startsWith("Basic "))
        val (status, body)  =
          if !authenticated then 401 -> ""
          else if query.contains("a=known") then 200 -> "1.2.3"
          else if query.contains("a=with+space") then 200 -> "2.0.0" // url-encoded
          else if query.contains("a=missing") then 404 -> """{"errors":[{"status":404}]}"""
          else 500 -> "boom"
        val bytes           = body.getBytes
        exchange.sendResponseHeaders(status, if bytes.isEmpty then -1 else bytes.length.toLong)
        if bytes.nonEmpty then exchange.getResponseBody.write(bytes)
        exchange.close()
    )
    server.start()
  end beforeAll

  override def afterAll(): Unit = server.stop(0)

  // PATH and HOME are set on every machine - as user and password of the test
  private def artifactory(port: Int = server.getAddress.getPort) =
    RepoConfig.Artifactory("release", s"http://127.0.0.1:$port/artifactory", "releases", "PATH", "HOME")

  private def withOut[A](body: => A): (A, String) =
    val out    = ByteArrayOutputStream()
    val result = Console.withOut(out)(body)
    result -> out.toString

  test("a known package - its version"):
    val repo = artifactory()
    assertEquals(withOut(repo.versionLookup("known", "acme")), Some("1.2.3") -> "")
    assertEquals(repo.versionLookup("with space", "acme"), Some("2.0.0"))

  test("a package that is not in the repo (404) - None, no warning"):
    assertEquals(withOut(artifactory().versionLookup("missing", "acme")), None -> "")

  test("another HTTP status - None, a warning once per repo"):
    val repo              = artifactory()
    val (first, warning)  = withOut(repo.versionLookup("broken", "acme"))
    assertEquals(first, None)
    assert(warning.contains("[warn] The version of acme:broken could not be looked up"), warning)
    assert(warning.contains("HTTP 500"), warning)
    assertEquals(withOut(repo.versionLookup("broken", "acme")), None -> "")

  test("no server (curl fails) - None, a warning"):
    val closedPort = { val s = java.net.ServerSocket(0); val p = s.getLocalPort; s.close(); p }
    val (result, warning) = withOut(artifactory(closedPort).versionLookup("known", "acme"))
    assertEquals(result, None)
    assert(warning.contains("could not be looked up") && warning.contains("curl 7"), warning)

end VersionLookupTest
