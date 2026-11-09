package orchescala.engine.config

import com.sun.net.httpserver.HttpServer
import munit.FunSuite

import java.net.InetSocketAddress

/** `Artifactory.versionLookup` against a local stand-in of Artifactory's search API - curl as in
  * the helper, no network.
  */
class VersionLookupTest extends FunSuite:

  private var server: HttpServer = null
  private val requests            = java.util.concurrent.atomic.AtomicInteger(0)

  override def beforeAll(): Unit =
    server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/artifactory/api/search/latestVersion",
      exchange =>
        requests.incrementAndGet()
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

  // the lookup runs curl - without it there is nothing to test
  private lazy val hasCurl =
    scala.util.Try(os.proc("curl", "--version").call(check = false).exitCode == 0).getOrElse(false)

  private val credentials = Map("TEST_REPO_USER" -> "me", "TEST_REPO_PWD" -> """se"c\ret""").get

  private def artifactory(port: Int = server.getAddress.getPort) =
    RepoConfig.Artifactory("release", s"http://127.0.0.1:$port/artifactory", "releases", "TEST_REPO_USER", "TEST_REPO_PWD")

  /** the lookup of a repo - and the warnings it gave */
  private class Lookup(repo: RepoConfig.Artifactory):
    var warnings: Seq[String] = Seq.empty
    val lookup                = repo.versionLookupWith(credentials, w => warnings :+= w)

  override def beforeEach(context: BeforeEach): Unit =
    assume(hasCurl, "curl is not installed")

  test("a known package - its version"):
    val repo = Lookup(artifactory())
    assertEquals(repo.lookup("known", "acme"), Some("1.2.3"))
    assertEquals(repo.lookup("with space", "acme"), Some("2.0.0"))
    assertEquals(repo.warnings, Seq.empty)

  test("a package that is not in the repo (404) - None, no warning"):
    val repo = Lookup(artifactory())
    assertEquals(repo.lookup("missing", "acme"), None)
    assertEquals(repo.warnings, Seq.empty)

  test("another HTTP status - None, a warning; the further lookups of the repo are skipped"):
    val repo   = Lookup(artifactory())
    assertEquals(repo.lookup("broken", "acme"), None)
    val before = requests.get
    // skipped - each would block up to 15 s with the repo unreachable
    assertEquals(repo.lookup("known", "acme"), None)
    assertEquals(requests.get, before, "no request after the failure")
    assertEquals(repo.warnings.size, 1, repo.warnings)
    assert(repo.warnings.head.contains("the further lookups in this repo are skipped"), repo.warnings)
    assert(repo.warnings.head.contains("[warn] The version of acme:broken could not be looked up"), repo.warnings)
    assert(repo.warnings.head.contains("HTTP 500"), repo.warnings)

  test("no server (curl fails) - None, a warning"):
    val closedPort = { val s = java.net.ServerSocket(0); val p = s.getLocalPort; s.close(); p }
    val repo       = Lookup(artifactory(closedPort))
    assertEquals(repo.lookup("known", "acme"), None)
    assert(repo.warnings.exists(w => w.contains("could not be looked up") && w.contains("curl 7")), repo.warnings)

  test("without the credentials variables - None, no request"):
    val lookup = artifactory().versionLookupWith(_ => None, w => fail(s"no warning expected: $w"))
    assertEquals(lookup("known", "acme"), None)

end VersionLookupTest
