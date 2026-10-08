package orchescala.helper.dev.publish

import munit.FunSuite

/** The check of the release repository: the version free, the credentials right, curl. */
class RepoCheckTest extends FunSuite:


  // what the generated builds publish under: ProjectDef.org = the company, no suffix (crossPaths off)
  private val names = RepoCheck.BuildNames("democompany", "")

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
    assert(redirect.getMessage.contains("redirects"), redirect.getMessage)
    val down     = intercept[IllegalStateException](RepoCheck.verifyUrlsFree("1.2.3", urls, _ => 0))
    assert(down.getMessage.contains("not reachable"), down.getMessage)
    val odd      = intercept[IllegalStateException](RepoCheck.verifyUrlsFree("1.2.3", urls, _ => 500))
    assert(odd.getMessage.contains("unexpected status (500)"), odd.getMessage)

  test("the organization comes from the build's ProjectDef.scala - a dotted one as well"):
    assertEquals(RepoCheck.organization("""  val org = "democompany""""), "democompany")
    assertEquals(RepoCheck.organization("""  val org = "ch.foo.bar" // the groupId"""), "ch.foo.bar")
    val error = intercept[IllegalStateException](RepoCheck.organization("object ProjectDef {}"))
    assert(error.getMessage.contains("val org"), error.getMessage)

  test("the names of a build come from its project/ files - the check looks where publish uploads"):
    val dir = os.temp.dir(prefix = "build-names-")
    try
      os.write(dir / "project" / "ProjectDef.scala", """object ProjectDef { val org = "ch.foo.bar" }""", createFolders = true)
      os.write(dir / "project" / "Settings.scala", """object Settings { val scalaV = "3.7.4" }""")
      assertEquals(RepoCheck.BuildNames.from(dir), RepoCheck.BuildNames("ch.foo.bar", "_3"))
      val urls = RepoCheck.releaseArtifactUrls("https://repo", "ch.foo.bar", Seq("foo-customer-domain_3"), "1.2.3")
      assertEquals(urls, Seq("https://repo/ch/foo/bar/foo-customer-domain_3/1.2.3/foo-customer-domain_3-1.2.3.pom"))
    finally os.remove.all(dir)

  test("the artifact suffix comes from the build's Settings.scala"):
    val project = Seq("""  val scalaV = "3.7.4"""", "    crossPaths := false").mkString("\n")
    val company = Seq("""  val scalaV = "3.7.4"""", "    // crossPaths := false,").mkString("\n")
    assertEquals(RepoCheck.artifactSuffix(project), "")
    assertEquals(RepoCheck.artifactSuffix(company), "_3")
    assertEquals(RepoCheck.artifactSuffix("""val scalaV = "2.13.16""""), "_2")
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
    val stripped = RepoCheck.withoutComments(code)
    assert(!stripped.contains("a char literal") && !stripped.contains("another") && !stripped.contains("gone"), stripped)
    assert(stripped.contains("a // not a comment /* nor this */"), stripped) // the triple-quoted string as it is
    assert(stripped.contains("""val crossPaths = "kept""""), stripped)
    // nested block comments, as Scala has them
    assertEquals(RepoCheck.withoutComments("a /* one /* two */ still one */ b").trim, "a  b".trim)
    assertEquals(
      RepoCheck.artifactSuffix(Seq("""val scalaV = "3.7.4"""", "/* outer /* crossPaths := false */ */").mkString("\n")),
      "_3"
    )

  test("the sub projects of the domain are published too - and looked for"):
    import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
    import orchescala.helper.util.DevConfig
    val devConfig = DevConfig(
      ApiProjectConfig("democompany-customer", VersionConfig("1.2.3"), Seq("cards", "loans"), Seq.empty, Seq.empty, ModuleType.projectModules)
    )
    val artifacts = RepoCheck.releaseArtifacts(devConfig, names)
    assert(artifacts.contains("democompany-customer-domain"), artifacts)
    assert(artifacts.contains("democompany-customer-domain-base"), artifacts)
    assert(artifacts.contains("democompany-customer-domain-cards"), artifacts)
    assert(artifacts.contains("democompany-customer-domain-loans"), artifacts)
    assert(!artifacts.contains("democompany-customer-worker-base"), artifacts) // only the domain has sub projects

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
          if path.endsWith("/redirect") then
            exchange.getResponseHeaders.add("Location", "/repo/missing")
            302
          else if !authorized(exchange) then 401
          else if path.contains("taken") || path.matches(".*/api/v4/projects/[^/]+") then 200 // a GitLab project
          else 404
        exchange.sendResponseHeaders(status, -1)
        exchange.close()
    )
    server.start()
    try body(s"http://127.0.0.1:${server.getAddress.getPort}", () => requests.toSeq)
    finally server.stop(0)
  end withRepo

  test("curlStatus: status codes, no redirect followed, the credentials of the config, unreachable"):
    withRepo(e => Option(e.getRequestHeaders.getFirst("Private-Token")).contains("secret")): (base, _) =>
      val config = Seq("""header = "Private-Token: secret"""")
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/taken"), 200)
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/missing"), 404)
      assertEquals(RepoCheck.curlStatus(config)(s"$base/repo/redirect"), 302)
      assertEquals(RepoCheck.curlStatus(Seq.empty)(s"$base/repo/taken"), 401)
    // nobody listens there - `000` becomes 0
    assertEquals(RepoCheck.curlStatus(Seq.empty)("http://127.0.0.1:1/repo"), 0)

  test("curlStatus: a server that does not answer in time is 0"):
    import com.sun.net.httpserver.HttpServer
    import java.net.InetSocketAddress
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/", exchange => { Thread.sleep(3000); exchange.sendResponseHeaders(200, -1); exchange.close() })
    server.start()
    try assertEquals(RepoCheck.curlStatus(Seq.empty, timeoutSeconds = 1)(s"http://127.0.0.1:${server.getAddress.getPort}/slow"), 0)
    finally server.stop(0)

  test("curl that fails before any status: 0, not an error - the report's unreachable branch"):
    assertEquals(RepoCheck.curlStatus(Seq.empty, curl = "true")("http://127.0.0.1:1/repo"), 0)

  test("a program that answers no status is an error - not a free version"):
    val error = intercept[IllegalStateException]:
      RepoCheck.curlStatus(Seq.empty, curl = "echo")("http://127.0.0.1:1/repo")
    assert(error.getMessage.contains("answered no HTTP status"), error.getMessage)

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


  test("buildx is checked before the first sbt run when the images are built for a platform"):
    var asked = Seq.empty[Seq[String]]
    DockerCheck.verifyBuildx(Seq("--platform", "linux/amd64"), cmd => { asked :+= cmd; 0 })
    assertEquals(asked, Seq(Seq("docker", "buildx", "version")))
    val error = intercept[IllegalStateException]:
      DockerCheck.verifyBuildx(Seq("--platform", "linux/amd64"), _ => 1)
    assert(error.getMessage.contains("brew install docker-buildx"), error.getMessage)
    // no platform asked for: nothing to check
    DockerCheck.verifyBuildx(Seq.empty, _ => fail("not asked"))
    DockerCheck.verifyBuildx(Seq("--no-cache"), _ => fail("not asked"))

end RepoCheckTest
