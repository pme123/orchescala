package orchescala.helper.dev.publish

import munit.FunSuite

/** The check of the release repository: the version free, the credentials right, curl. */
class RepoCheckTest extends FunSuite:


  // what the generated project build publishes: ProjectDef.org = the company, its name, the
  // modules of build.sbt, no suffix (crossPaths off)
  private val names = RepoCheck.BuildNames(
    "democompany",
    "democompany-customer",
    Seq("domain", "api", "dmn", "simulation", "worker"),
    ""
  )

  private val urls = RepoCheck.releaseArtifactUrls(
    "https://repo.example.com/artifactory/libs-release",
    "com.example",
    Seq("example-customer-domain", "example-customer-worker"),
    "1.2.3"
  )

  test("the poms of the modules in the release repo"):
    assertEquals(
      urls,
      Seq(
        "https://repo.example.com/artifactory/libs-release/com/example/example-customer-domain/1.2.3/example-customer-domain-1.2.3.pom",
        "https://repo.example.com/artifactory/libs-release/com/example/example-customer-worker/1.2.3/example-customer-worker-1.2.3.pom"
      )
    )

  test("a free version: every module is missing"):
    RepoCheck.verifyUrlsFree("1.2.3", urls, _ => 404)

  test("a taken version - also when only one module of a half-finished release is there"):
    val error = intercept[IllegalStateException]:
      RepoCheck.verifyUrlsFree("1.2.3", urls, url => if url.contains("worker") then 200 else 404)
    assert(error.getMessage.contains("is in the repository already"), error.getMessage)
    assert(error.getMessage.contains("example-customer-worker"), error.getMessage)

  test("the company's artifacts carry the Scala suffix, a project's do not"):
    val company = RepoCheck.releaseArtifactUrls(
      "https://repo", "valiant", Seq("valiant-orchescala-domain_3"), "1.2.3"
    )
    assertEquals(company, Seq("https://repo/valiant/valiant-orchescala-domain_3/1.2.3/valiant-orchescala-domain_3-1.2.3.pom"))

  test("wrong credentials, a redirect and an unreachable repository stop the release"):
    val refused  = intercept[IllegalStateException](RepoCheck.verifyUrlsFree("1.2.3", urls, _ => 401))
    assert(refused.getMessage.contains("refuses the credentials"), refused.getMessage)
    val redirect = intercept[IllegalStateException](RepoCheck.verifyUrlsFree("1.2.3", urls, _ => 302))
    assert(redirect.getMessage.contains("redirects elsewhere"), redirect.getMessage)
    val down     = intercept[IllegalStateException](RepoCheck.verifyUrlsFree("1.2.3", urls, _ => 0))
    assert(down.getMessage.contains("not reachable"), down.getMessage)
    val odd      = intercept[IllegalStateException](RepoCheck.verifyUrlsFree("1.2.3", urls, _ => 500))
    assert(odd.getMessage.contains("unexpected status (500)"), odd.getMessage)

  test("the organization comes from the build's ProjectDef.scala - a dotted one as well"):
    assertEquals(RepoCheck.organization("""  val org = "democompany""""), "democompany")
    assertEquals(RepoCheck.organization("""  val org = "ch.foo.bar" // the groupId"""), "ch.foo.bar")
    val error = intercept[IllegalStateException](RepoCheck.organization("object ProjectDef {}"))
    assert(error.getMessage.contains("val org"), error.getMessage)

  test("the names of a build come from its own files - the check looks where publish uploads"):
    val dir = os.temp.dir(prefix = "build-names-")
    try
      os.write(dir / "project" / "ProjectDef.scala", """object ProjectDef { val org = "ch.foo.bar"; val name = "foo-customer" }""", createFolders = true)
      os.write(dir / "project" / "Settings.scala", """object Settings { val scalaV = "3.7.4" }""")
      os.write(dir / "build.sbt", Seq(
        """lazy val root = project.settings(projectSettings(), publicationSettings)""",
        """lazy val domain = project.settings(projectSettings(Some("domain")), publicationSettings)""",
        """lazy val domainBase = project.settings(projectSettings(Some("domain-base"), Some("domain")))""",
        """lazy val domainCards = project.settings(projectSettings(Some("domain-cards"), Some("domain")))""",
        """// lazy val old = project.settings(projectSettings(Some("old")))""",
        """lazy val worker = project.settings(projectSettings(Some("worker")))"""
      ).mkString("\n"))
      val names = RepoCheck.BuildNames.from(dir)
      assertEquals(names, RepoCheck.BuildNames("ch.foo.bar", "foo-customer", Seq("domain", "domain-base", "domain-cards", "worker"), "_3"))
      assertEquals(
        RepoCheck.releaseArtifacts(names),
        Seq("foo-customer-domain_3", "foo-customer-domain-base_3", "foo-customer-domain-cards_3", "foo-customer-worker_3")
      )
      val urls = RepoCheck.releaseArtifactUrls("https://repo", "ch.foo.bar", Seq("foo-customer-domain_3"), "1.2.3")
      assertEquals(urls, Seq("https://repo/ch/foo/bar/foo-customer-domain_3/1.2.3/foo-customer-domain_3-1.2.3.pom"))
    finally os.remove.all(dir)

  test("a build without a module, or without a name, is not guessed"):
    intercept[IllegalStateException](RepoCheck.BuildNames.modules("lazy val root = project"))
    intercept[IllegalStateException](RepoCheck.projectName("""object ProjectDef { val org = "x" }"""))

  test("a value set more than once is not guessed either - the first could be the wrong one"):
    val twice = intercept[IllegalStateException]:
      RepoCheck.projectName("""object ProjectDef { val name = "a"; object Nested { val name = "b" } }""")
    assert(twice.getMessage.contains("more than once") && twice.getMessage.contains("a, b"), twice.getMessage)
    intercept[IllegalStateException](RepoCheck.organization("""val org = "a"\nval org = "b""""))
    intercept[IllegalStateException](RepoCheck.artifactSuffix("""val scalaV = "3.7.4"\nval scalaV = "2.13.16""""))
    // the same value twice is one value
    assertEquals(RepoCheck.organization("""val org = "a"\nval org = "a""""), "a")

  test("the artifact suffix comes from the build's Settings.scala"):
    val project = Seq("""  val scalaV = "3.7.4"""", "    crossPaths := false").mkString("\n")
    val company = Seq("""  val scalaV = "3.7.4"""", "    // crossPaths := false,").mkString("\n")
    assertEquals(RepoCheck.artifactSuffix(project), "")
    assertEquals(RepoCheck.artifactSuffix(company), "_3")
    assertEquals(RepoCheck.artifactSuffix("""val scalaV = "2.13.16""""), "_2.13") // the binary version of Scala 2
    val odd = intercept[IllegalStateException](RepoCheck.artifactSuffix("""val scalaV = "4.0.1""""))
    assert(odd.getMessage.contains("Scala 4.0"), odd.getMessage)
    // spelled without spaces, inside a larger line - and only in code, not in a comment
    assertEquals(RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "crossPaths:=false").mkString("\n")), "")
    // after a string with a slash in it; in a block comment; in a string (no comment)
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", """  resolvers += "https://repo", crossPaths := false""").mkString("\n")),
      ""
    )
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "  /* crossPaths := false */").mkString("\n")),
      "_3"
    )
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", """  val note = "// crossPaths := false" """, "  crossPaths := false").mkString("\n")),
      ""
    )
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "  Seq(publishMavenStyle := true, crossPaths := false)").mkString("\n")),
      ""
    )
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "  publishMavenStyle := true, // crossPaths := false").mkString("\n")),
      "_3"
    )
    val error = intercept[IllegalStateException](RepoCheck.artifactSuffix("object Settings {}"))
    assert(error.getMessage.contains("scalaV"), error.getMessage)
    // a commented-out scalaV above the real one
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""  // val scalaV = "2.13.16"""", """  val scalaV = "3.7.4"""").mkString("\n")),
      "_3"
    )

  test("withoutComments: char literals and triple-quoted strings are no comments, and end no strings"):
    val code = Seq(
      """val quote = '"' // a char literal""",
      """val slash = '/' /* another */ + "x"""",
      "val tri = \"\"\"a // not a comment /* nor this */\"\"\"",
      "// gone",
      """val crossPaths = "kept" """
    ).mkString("\n")
    val stripped = ScalaSource.withoutComments(code)
    assert(!stripped.contains("a char literal") && !stripped.contains("another") && !stripped.contains("gone"), stripped)
    assert(stripped.contains("a // not a comment /* nor this */"), stripped) // the triple-quoted string as it is
    assert(stripped.contains("""val crossPaths = "kept""""), stripped)
    // nested block comments, as Scala has them
    assertEquals(ScalaSource.withoutComments("a /* one /* two */ still one */ b").trim, "a  b".trim)
    // an interpolation with a comment marker in it, a unicode char literal, an unterminated block
    assertEquals(ScalaSource.withoutComments("""s"a${"//"}b" // c"""), """s"a${"//"}b" """)
    assertEquals(ScalaSource.withoutComments("""'\u0022' // c"""), """'\u0022' """)
    assertEquals(ScalaSource.withoutComments("a /* never closed\nb"), "a ")
    // a string with a brace inside an interpolation; a prime of an identifier is no char literal
    assertEquals(ScalaSource.withoutComments("""s"${"}"}x" // c"""), """s"${"}"}x" """)
    assertEquals(ScalaSource.withoutComments("""val x' = y' // c"""), """val x' = y' """)
    assertEquals(ScalaSource.withoutComments("""val q = '"' // c"""), """val q = '"' """)
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "/* outer /* crossPaths := false */ */").mkString("\n")),
      "_3"
    )

  test("crossPaths set both ways is no suffix - said, not guessed"):
    val error = intercept[IllegalStateException]:
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "crossPaths := false", "crossPaths := true").mkString("\n"))
    assert(error.getMessage.contains("both ways"), error.getMessage)

  test("a transient failure: once more after a pause - then as it is"):
    var calls  = 0
    val flaky  = (_: String) => { calls += 1; if calls == 1 then 0 else 404 }
    assertEquals(RepoCheck.retryingOnce(flaky, pause = 10)("u"), 404)
    assertEquals(calls, 2)
    assertEquals(RepoCheck.retryingOnce(_ => 0, pause = 10)("u"), 0)
    assertEquals(RepoCheck.retryingOnce(_ => 200, pause = 10)("u"), 200)


  /** A small HTTP server playing the repository: `taken` paths exist, the rest is missing, a
    * `redirect` path redirects, and without the expected credentials everything is 401. Every
    * request path is recorded.
    */
  private def withRepo(authorized: com.sun.net.httpserver.HttpExchange => Boolean)(
      body: (String, () => Seq[String]) => Unit
  ): Unit =
    import com.sun.net.httpserver.HttpServer
    import java.net.InetSocketAddress
    val requests = collection.mutable.ListBuffer.empty[String]
    val server   = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext(
      "/",
      exchange =>
        val path   = exchange.getRequestURI.getPath
        requests += path
        val status =
          if path.contains("/nohead/") && exchange.getRequestMethod == "HEAD" then 405 // no HEAD here - GET answers
          else if path.endsWith("/redirect") then // on this host: followed
            exchange.getResponseHeaders.add("Location", "/repo/missing")
            302
          else if path.endsWith("/away") then // to another host: not followed
            exchange.getResponseHeaders.add("Location", "http://other.invalid:1/repo/taken")
            302
          else if !authorized(exchange) then 401
          else if path.contains("taken") || path.matches(".*/api/v4/projects/[^/]+") then 200 // a GitLab project
          else if path.contains("partial") && path.contains("-domain") then 200 // a half-finished upload
          else 404
        exchange.sendResponseHeaders(status, -1)
        exchange.close()
    )
    server.start()
    try body(s"http://127.0.0.1:${server.getAddress.getPort}", () => requests.toSeq)
    finally server.stop(0)
  end withRepo

  private def assumeCurl(): Unit =
    assume(scala.util.Try(os.proc("curl", "--version").call(check = false).exitCode == 0).getOrElse(false), "curl")

  test("the last release is the positive control of the check - found, or the URLs are wrong"):
    withRepo(_ => true): (base, requests) =>
      import orchescala.engine.config.RepoConfig
      val repo   = RepoConfig.Gitlab("release", s"$base/repo")
      val status = RepoCheck.curlStatus(Seq.empty)
      RepoCheck.verifyLastRelease(None, names, repo, status) // before the first release: nothing to control
      RepoCheck.verifyLastRelease(Some("1.0.0-taken"), names, repo, status) // found
      assert(requests().last.endsWith("/democompany-customer-domain/1.0.0-taken/democompany-customer-domain-1.0.0-taken.pom"), requests().last)
      val wrong = intercept[IllegalStateException](RepoCheck.verifyLastRelease(Some("1.0.0"), names, repo, status))
      assert(wrong.getMessage.contains("not found where the check looks"), wrong.getMessage)
      // through the check itself
      import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
      import orchescala.engine.config.ReposConfig
      import orchescala.helper.util.{DevConfig, SbtConfig}
      val devConfig = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(repos = Seq(repo))))
      // (no credentials: the anonymous question is answered with yes here - the test is about the control)
      RepoCheck.verifyVersionFree("1.2.3", devConfig, names, _ => None, confirm = _ => true, lastRelease = Some("1.0.0-taken"))
      val notFound = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", devConfig, names, _ => None, confirm = _ => true, lastRelease = Some("1.0.0"))
      assert(notFound.getMessage.contains("not found where the check looks"), notFound.getMessage)

  test("the last release among the tags"):
    assertEquals(PublishHelper.lastRelease(Seq("v1.9.18", "v1.10.0", "v1.9.19", "not-a-release")), Some("1.10.0"))
    assertEquals(PublishHelper.lastRelease(Seq.empty), None)

  test("curlStatus: status codes, a redirect followed on the host only, the credentials of the config, unreachable"):
    assumeCurl()
    withRepo(e => Option(e.getRequestHeaders.getFirst("Private-Token")).contains("secret")): (base, requests) =>
      val config = Seq("""header = "Private-Token: secret"""")
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/taken"), 200)
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/missing"), 404)
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/redirect"), 404) // followed - with the token
      assert(requests().takeRight(2) == Seq("/repo/redirect", "/repo/missing"), requests())
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/away"), 302)     // another host: not followed
      // no HEAD: the first byte is asked for with a GET - taken is 200, missing 404
      assertEquals(RepoCheck.curlStatus(config)(s"$base/nohead/taken"), 200)
      assertEquals(RepoCheck.curlStatus(config)(s"$base/nohead/missing"), 404)
      assert(requests().takeRight(4) == Seq("/nohead/taken", "/nohead/taken", "/nohead/missing", "/nohead/missing"), requests())
      assertEquals(RepoCheck.curlStatus(Seq.empty)(s"$base/repo/taken"), 401)
    // nobody listens there - `000` becomes 0
    assertEquals(RepoCheck.curlStatus(Seq.empty)("http://127.0.0.1:1/repo"), 0)

  test("curlStatus: a server that does not answer in time is 0"):
    assumeCurl()
    import com.sun.net.httpserver.HttpServer
    import java.net.InetSocketAddress
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    // the handler is slower than curl's patience (the thread outlives the test - the server is stopped)
    server.createContext("/", exchange => { Thread.sleep(2000); exchange.sendResponseHeaders(200, -1); exchange.close() })
    server.start()
    try assertEquals(RepoCheck.curlStatus(Seq.empty, timeoutSeconds = 1)(s"http://127.0.0.1:${server.getAddress.getPort}/slow"), 0)
    finally server.stop(0)

  test("curl that fails before any status: 0, not an error - the report's unreachable branch"):
    assumeCurl()
    assertEquals(RepoCheck.curlStatus(Seq.empty, curl = "true")("http://127.0.0.1:1/repo"), 0)

  test("a program that answers no status is 0 - like any failure of the transport (tried once more, then said)"):
    assume(!scala.util.Properties.isWin, "true, echo")
    assertEquals(RepoCheck.curlStatus(Seq.empty, curl = "echo")("http://127.0.0.1:1/repo"), 0)

  test("a redirect stays on the host: the same scheme and port, or up to https - never down, never elsewhere"):
    assert(RepoCheck.sameHost("http://repo:8080/a", "http://repo:8080/b"))
    assert(RepoCheck.sameHost("http://repo/a", "https://repo/b"))      // an upgrade
    assert(!RepoCheck.sameHost("https://repo/a", "http://repo/b"))     // a downgrade
    assert(!RepoCheck.sameHost("http://repo:8080/a", "http://repo:9090/b"))
    assert(!RepoCheck.sameHost("https://repo/a", "https://other/b"))
    assert(!RepoCheck.sameHost("https://repo/a", ""))
    assert(!RepoCheck.sameHost("https://repo/a", "not a url ::"))

  test("without curl: a clear message, no stack trace of a missing program"):
    val error = intercept[IllegalStateException]:
      RepoCheck.curlStatus(Seq.empty, curl = "/no/such/curl")("http://127.0.0.1:1/repo")
    assert(error.getMessage.contains("`/no/such/curl` is needed"), error.getMessage)

  test("a GitLab project registry: the project tells whether the token reads it"):
    val registry = "https://gitlab.example.com/api/v4/projects/42/packages/maven"
    assertEquals(RepoCheck.gitlabProjectUrl(registry), Some("https://gitlab.example.com/api/v4/projects/42"))
    assertEquals(RepoCheck.gitlabProjectUrl("https://gitlab.example.com/api/v4/groups/7/-/packages/maven"), None)
    RepoCheck.verifyGitlabCredentials(registry, _ => 200, confirm = _ => fail("nothing to ask with 200"))
    // not shown to the token: wrong - or a deploy token that may not read the project: asked
    RepoCheck.verifyGitlabCredentials(registry, _ => 404, confirm = _ => true)
    val refused = intercept[IllegalStateException](RepoCheck.verifyGitlabCredentials(registry, _ => 404, confirm = _ => false))
    assert(refused.getMessage.contains("does not show") && refused.getMessage.contains("release stopped"), refused.getMessage)
    // a group registry can not be checked: goes on when confirmed, else stops
    val group = "https://gitlab.example.com/api/v4/groups/7/-/packages/maven"
    RepoCheck.verifyGitlabCredentials(group, _ => fail("nothing to ask"), confirm = _ => true)
    val stopped = intercept[IllegalStateException]:
      RepoCheck.verifyGitlabCredentials(group, _ => fail("nothing to ask"), confirm = _ => false)
    assert(stopped.getMessage.contains("release stopped"), stopped.getMessage)

  test("verifyVersionFree for a GitLab DevConfig - the project first, then the poms"):
    import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
    import orchescala.engine.config.{RepoConfig, RepoCredentials, ReposConfig}
    import orchescala.helper.util.{DevConfig, SbtConfig}
    withRepo(e =>
      Option(e.getRequestHeaders.getFirst("Private-Token")).contains("secret") ||
        Option(e.getRequestHeaders.getFirst("Job-Token")).contains("secret")
    ): (base, requests) =>
      val names     = this.names.copy(modules = Seq("domain")) // one pom, the test is about the probe
      val devConfig = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, Seq(ModuleType.domain))
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(
        credentials = Seq(RepoCredentials.PrivateToken("gitlab", "127.0.0.1", "GITLAB_TOKEN")),
        repos = Seq(RepoConfig.Gitlab("release", s"$base/api/v4/projects/42/packages/maven"))
      )))
      RepoCheck.verifyVersionFree("1.2.3", devConfig, names, Map("GITLAB_TOKEN" -> "secret").get)
      assertEquals(
        requests(),
        Seq(
          "/api/v4/projects/42",
          "/api/v4/projects/42/packages/maven/democompany/democompany-customer-domain/1.2.3/democompany-customer-domain-1.2.3.pom"
        )
      )
      val wrong = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", devConfig, names, Map("GITLAB_TOKEN" -> "wrong").get, confirm = _ => false)
      assert(wrong.getMessage.contains("does not show"), wrong.getMessage)
      // no credentials at all: the check would run anonymously - it asks, and stops without a yes
      val anonymous = devConfig.withSbtConfig(SbtConfig(reposConfig = ReposConfig(
        repos = Seq(RepoConfig.Gitlab("release", s"$base/api/v4/projects/42/packages/maven"))
      )))
      val stopped   = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", anonymous, names, _ => None, confirm = _ => false)
      assert(stopped.getMessage.contains("anonymously"), stopped.getMessage)
      // a pipeline: the job token is GitLab's own - the project is not probed
      val before = requests().size
      RepoCheck.verifyVersionFree("1.2.3", devConfig, names, Map("CI_JOB_TOKEN" -> "secret", "CI_SERVER_HOST" -> "127.0.0.1").get)
      assertEquals(requests().drop(before).size, 1)
      assert(requests().last.endsWith("-1.2.3.pom"), requests().last)

  /** The whole check for a project: the Artifactory repo of its DevConfig, the user/password
    * from the environment (as basic auth), the poms of its modules (the company as groupId,
    * `ProjectDef.org`), the suffix.
    */
  test("verifyVersionFree for a DevConfig - the URLs of its modules, the credentials, the result"):
    import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
    import orchescala.engine.config.{RepoConfig, ReposConfig}
    import orchescala.helper.util.{DevConfig, SbtConfig}
    val basic = java.util.Base64.getEncoder.encodeToString("me:secret".getBytes)
    withRepo(e => Option(e.getRequestHeaders.getFirst("Authorization")).contains(s"Basic $basic")): (base, requests) =>
      val devConfig = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(repos = Seq(
        RepoConfig.Artifactory("release", base, "libs-release", "REPO_USER", "REPO_PWD")
      ))))
      val env       = Map("REPO_USER" -> "me", "REPO_PWD" -> "secret")
      RepoCheck.verifyVersionFree("1.2.3", devConfig, names, env.get)
      assertEquals(
        requests(),
        ModuleType.projectModules.map(m =>
          s"/libs-release/democompany/democompany-customer-$m/1.2.3/democompany-customer-$m-1.2.3.pom"
        )
      )
      // the company's suffix
      RepoCheck.verifyVersionFree("1.2.3", devConfig, names.copy(artifactSuffix = "_3"), env.get)
      assert(requests().last.endsWith("/democompany-customer-worker_3/1.2.3/democompany-customer-worker_3-1.2.3.pom"), requests().last)
      // wrong credentials stop it
      val refused = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", devConfig, names, Map("REPO_USER" -> "me", "REPO_PWD" -> "wrong").get)
      assert(refused.getMessage.contains("refuses the credentials"), refused.getMessage)
      // missing environment variables stop it before any request
      val before  = requests().size
      intercept[IllegalStateException](RepoCheck.verifyVersionFree("1.2.3", devConfig, names, _ => None))
      assertEquals(requests().size, before)
      // a taken module
      val taken = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3-taken", devConfig, names, env.get)
      assert(taken.getMessage.contains("is in the repository already"), taken.getMessage)
      // after a failed upload: what is there
      val uploaded = RepoCheck.reportUploaded("1.2.3-taken", devConfig, names, env.get)
      assertEquals(uploaded.size, ModuleType.projectModules.size)
      assertEquals(RepoCheck.reportUploaded("1.2.3", devConfig, names, env.get), Seq.empty)
      assertEquals(RepoCheck.reportUploaded("1.2.3", devConfig, names, _ => None), Seq.empty) // never fails
      // a half-finished upload (Docker pushed, `publish` failed after the domain): only the domain is named
      val partial = RepoCheck.reportUploaded("1.2.3-partial", devConfig, names, env.get)
      assertEquals(partial.map(_.split('/').last), Seq("democompany-customer-domain-1.2.3-partial.pom"))
      // bounded in all: out of time, no pom is asked
      val before2 = requests().size
      assertEquals(RepoCheck.reportUploaded("1.2.3-taken", devConfig, names, env.get, budgetMillis = 0), Seq.empty)
      assertEquals(requests().size, before2)
    // an unreachable repository: one request, then it gives up
    locally:
      import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
      import orchescala.engine.config.{RepoConfig, ReposConfig}
      import orchescala.helper.util.{DevConfig, SbtConfig}
      val down    = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(repos = Seq(RepoConfig.Gitlab("release", "http://127.0.0.1:1/repo")))))
      val started = System.nanoTime()
      assertEquals(RepoCheck.reportUploaded("1.2.3", down, names, _ => None), Seq.empty)
      assert((System.nanoTime() - started) / 1e6 < 3000, "gave up after the first unreachable pom")


  test("a pipeline says yes with ORCHESCALA_PUBLISH_YES - to the GitLab questions only"):
    assert(RepoCheck.pipelineYes(Map("ORCHESCALA_PUBLISH_YES" -> " TRUE ").get).exists(_("a deploy token")))
    assertEquals(RepoCheck.pipelineYes(_ => None), None)
    withRepo(e => Option(e.getRequestHeaders.getFirst("Private-Token")).contains("t")): (base, _) =>
      import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
      import orchescala.engine.config.{RepoConfig, RepoCredentials, ReposConfig}
      import orchescala.helper.util.{DevConfig, SbtConfig}
      val devConfig = DevConfig(
        ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq.empty, Seq.empty, Seq.empty, Seq(ModuleType.domain))
      ).withSbtConfig(SbtConfig(reposConfig = ReposConfig(
        credentials = Seq(RepoCredentials.PrivateToken("gitlab", "127.0.0.1", "GITLAB_TOKEN")),
        repos = Seq(RepoConfig.Gitlab("release", s"$base/api/v4/groups/7/-/packages/maven"))
      )))
      // no credentials at all: the pipeline's yes does not answer that - a terminal's confirm would
      val anonymous = devConfig.withSbtConfig(SbtConfig(reposConfig = ReposConfig(
        repos = Seq(RepoConfig.Gitlab("release", s"$base/api/v4/groups/7/-/packages/maven"))
      )))
      val stopped   = intercept[IllegalStateException]:
        RepoCheck.verifyVersionFree("1.2.3", anonymous, names.copy(modules = Seq("domain")),
          Map("ORCHESCALA_PUBLISH_YES" -> "true").get, confirm = _ => false)
      assert(stopped.getMessage.contains("anonymously"), stopped.getMessage)
      // a group registry: asked - the pipeline's yes answers, the terminal's confirm is not used
      RepoCheck.verifyVersionFree(
        "1.2.3", devConfig, names.copy(modules = Seq("domain")),
        Map("GITLAB_TOKEN" -> "t", "ORCHESCALA_PUBLISH_YES" -> "true").get, confirm = _ => fail("the pipeline answered")
      )
    // the next-version question is not answered by it
    val dir = os.temp.dir(prefix = "yes-")
    try
      def git(args: String*) = os.proc("git" +: args).call(cwd = dir)
      git("init", "-q")
      git("config", "user.email", "test@example.com")
      git("config", "user.name", "test")
      os.write(dir / "a.txt", "a")
      git("add", ".")
      git("commit", "-q", "-m", "init")
      git("tag", "--no-sign", "v1.9.19")
      intercept[IllegalArgumentException](PublishHelper.verifyNextVersion("1.19.20", dir, _ => false))
    finally os.remove.all(dir)

  test("the console never shows a user info of a URL"):
    assertEquals(RepoCheck.withoutUserInfo("curl: (7) http://me:secret@repo.example.com/x failed"), "curl: (7) http://repo.example.com/x failed")
    assertEquals(RepoCheck.withoutUserInfo("https://repo.example.com/x"), "https://repo.example.com/x")

  test("buildx is checked before the first sbt run when the images are built for a platform"):
    var asked = Seq.empty[Seq[String]]
    DockerCheck.verifyBuildx(Seq("--platform", "linux/amd64"), cmd => { asked :+= cmd; 0 })
    assertEquals(asked, Seq(Seq("docker", "buildx", "version")))
    val error = intercept[IllegalStateException]:
      DockerCheck.verifyBuildx(Seq("--platform", "linux/amd64"), _ => 1)
    assert(error.getMessage.contains("brew install docker-buildx"), error.getMessage)
    // the builder must keep the image in the daemon - the `docker` driver
    DockerCheck.verifyBuildx(Seq("--platform", "linux/amd64"), _ => 0, _ => "Name: default\nDriver: docker\n")
    val container = intercept[IllegalStateException]:
      DockerCheck.verifyBuildx(Seq("--platform", "linux/amd64"), _ => 0, _ => "Name: mybuilder\nDriver: docker-container\n")
    assert(container.getMessage.contains("docker buildx use default"), container.getMessage)
    assertEquals(DockerCheck.builderDriver("Name: x\n Driver:   docker\nLast Activity: now"), Some("docker"))
    assertEquals(DockerCheck.builderDriver(""), None)
    // `--platform=...` is a platform too
    var askedEq = false
    DockerCheck.verifyBuildx(Seq("--platform=linux/amd64"), _ => { askedEq = true; 0 }, _ => "Driver: docker")
    assert(askedEq)
    // no platform asked for: nothing to check
    DockerCheck.verifyBuildx(Seq.empty, _ => fail("not asked"))
    DockerCheck.verifyBuildx(Seq("--no-cache"), _ => fail("not asked"))

end RepoCheckTest
