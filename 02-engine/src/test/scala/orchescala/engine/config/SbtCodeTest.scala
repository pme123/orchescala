package orchescala.engine.config

import munit.FunSuite


class SbtCodeTest extends FunSuite:

  test("a literal escapes quotes and backslashes"):
    assertEquals(SbtCode.literal("""a"b\c"""), """"a\"b\\c"""")

  test("envOrElse: the env variable with the value as fallback - or the value"):
    assertEquals(SbtCode.envOrElse(Some("A_URL"), "https://x"), """sys.env.get("A_URL").map(_.trim).filter(_.nonEmpty).getOrElse("https://x")""")
    assertEquals(SbtCode.envOrElse(None, """https://x/"y""""), """"https://x/\"y\""""")

  test("the env names of a company: upper case, other characters as _"):
    assertEquals(SbtCode.companyEnvName("acme-bank.ch", "MVN_RELEASE_REPOSITORY"), "ACME_BANK_CH_MVN_RELEASE_REPOSITORY")
    assertEquals(SbtCode.identifier("Acme-Bank.ch"), "acmebankch")

  test("the env names do not depend on the locale - only letters, digits and _"):
    // Locale.ROOT, without changing the default locale (JVM-wide): the Turkish dotless ı is I,
    // a dotted İ is no ASCII letter
    assertEquals(SbtCode.companyEnvPrefix("bankı"), "BANKI")
    assertEquals(SbtCode.companyEnvPrefix("İbank"), "_BANK")

  test("an identifier is a valid start of a Scala name"):
    assertEquals(SbtCode.identifier("3m"), "repo3m")
    assertEquals(SbtCode.identifier("--"), "repo")

  test("envValue: an empty variable counts as not set"):
    assertEquals(SbtCode.envValue("A_URL"), """sys.env.get("A_URL").map(_.trim).filter(_.nonEmpty)""")

  test("envUrlRequired: the url of the variable - not set, empty or with an `@` the build stops"):
    assertEquals(
      SbtCode.envUrlRequired("A_URL", "  "),
      """sys.env.get("A_URL").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty) match {
        |    case Some(u) if u.contains("@") => throw new IllegalArgumentException("A_URL must not contain an `@` - no user info: the credentials are in the ..._USERNAME / _PASSWORD variables: " + u.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1***@"))
        |    case Some(u) => u
        |    case None => throw new IllegalArgumentException("System Environment Variable A_URL is not set.")
        |  }""".stripMargin
    )

  test("urlValue: from the variable - nothing of the update; without variable the configured url"):
    val fromEnv = SbtCode.urlValue(Some("A_URL"), "https://bin.example.com/r", "  ")
    assertEquals(fromEnv, SbtCode.envUrlRequired("A_URL", "  "))
    assert(!fromEnv.contains("bin.example.com"), fromEnv)
    assertEquals(SbtCode.urlValue(None, "https://bin.example.com/r", "  "), """"https://bin.example.com/r"""")
    assertEquals(SbtCode.trimUrl(" https://x/r// "), "https://x/r")

  /** The generated code is only parsed in the tests - `envUrlValue` is its runtime twin (the
    * same regex constants), so this checks what the generated build does with a variable.
    */
  test("what the generated build does with a url variable: trim, drop a value with `@`, the host"):
    val cases = Seq(
      // variable                                              -> url of the resolver (None: the url of the update)
      " https://bin.example.com/artifactory/releases// "       -> Some("https://bin.example.com/artifactory/releases"),
      "https://my_bin.example.com:8443/artifactory/releases"   -> Some("https://my_bin.example.com:8443/artifactory/releases"),
      "https://[::1]:8080/artifactory/releases"                -> Some("https://[::1]:8080/artifactory/releases"),
      "  "                                                     -> None,
      // user info - not rewritten (an `@` in the path would give another host), not used
      "https://me:secret@bin.example.com/artifactory/releases" -> None,
      "https://u:pa/ss@bin.example.com/artifactory/releases"   -> None,
      "https://bin.example.com/artifactory/a@b"                -> None
    )
    cases.foreach: (variable, expected) =>
      assertEquals(SbtCode.envUrlValue(Some(variable)), expected, variable)
    assertEquals(SbtCode.envUrlValue(None), None)
    // the host of the credentials (RepoHost) - the same as the helper's
    Seq(
      "https://bin.example.com/artifactory/releases"         -> "bin.example.com",
      "https://my_bin.example.com:8443/artifactory/releases" -> "my_bin.example.com",
      "https://[::1]:8080/artifactory/releases"              -> "[::1]"
    ).foreach: (url, host) =>
      assertEquals(RepoConfig.hostOf(java.net.URI.create(url)), Some(host), url)
    assertEquals(SbtCode.maskUserInfo("https://u:pa/ss@bin.example.com/r"), "https://***@bin.example.com/r")

end SbtCodeTest
