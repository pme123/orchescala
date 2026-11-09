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

  test("envUrlOrElseWarn: a warning when the variable is not set"):
    assertEquals(
      SbtCode.envUrlOrElseWarn(Some("A_URL"), "https://x/r", "  "),
      """sys.env.get("A_URL").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty).map { u => if (u.contains("@")) println("[warn] A_URL has user info - it is removed, the credentials are in the ..._USERNAME / _PASSWORD variables: " + u.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1***@")); u.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1") }.getOrElse {
        |    println("[warn] A_URL is not set - the repo of the last ./helper.scala update: https://x/r")
        |    "https://x/r"
        |  }""".stripMargin
    )
    assertEquals(SbtCode.envUrlOrElseWarn(None, "https://x/r", "  "), """"https://x/r"""")

  test("envUrlOrElse: the url of the variable as the helper reads it (trimUrl)"):
    assertEquals(
      SbtCode.envUrlOrElse(Some("A_URL"), "https://x/r"),
      """sys.env.get("A_URL").map(_.trim.replaceAll("/+$", "")).filter(_.nonEmpty).map { u => u.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1") }.getOrElse("https://x/r")"""
    )
    assertEquals(SbtCode.envUrlOrElse(None, "https://x/r"), """"https://x/r"""")
    assertEquals(SbtCode.trimUrl(" https://x/r// "), "https://x/r")

  test("the generated build removes user info of a variable - sbt/coursier would log the password"):
    val withWarning = SbtCode.envUrlOrElseWarn(Some("A_URL"), "https://x/r", "  ")
    assert(withWarning.contains("""u.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1")"""), withWarning)
    assert(withWarning.contains("""println("[warn] A_URL has user info - it is removed"""), withWarning)
    // the warning masks it
    assert(withWarning.contains(""" + u.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1***@")"""), withWarning)
    // the same removal without warning (e.g. for the host of the credentials)
    assert(SbtCode.envUrlOrElse(Some("A_URL"), "https://x/r").contains("""u.replaceAll("^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@", "$1")"""))

  /** The generated code is only parsed in the tests - its regexes are the same constants as the
    * helper's runtime functions, so these check what the generated build does with a variable.
    */
  test("what the generated build does with a url: trim, remove user info, the host"):
    val cases = Seq(
      // variable                                              -> (url of the resolver, host)
      " https://bin.example.com/artifactory/releases// "       -> ("https://bin.example.com/artifactory/releases", "bin.example.com"),
      "https://me:secret@bin.example.com/artifactory/releases" -> ("https://bin.example.com/artifactory/releases", "bin.example.com"),
      "https://u:pa/ss@bin.example.com/artifactory/releases"   -> ("https://bin.example.com/artifactory/releases", "bin.example.com"),
      "https://my_bin.example.com:8443/artifactory/releases"   -> ("https://my_bin.example.com:8443/artifactory/releases", "my_bin.example.com"),
      "https://[::1]:8080/artifactory/releases"                -> ("https://[::1]:8080/artifactory/releases", "[::1]")
    )
    cases.foreach: (variable, expected) =>
      val url = SbtCode.removeUserInfo(SbtCode.trimUrl(variable))
      assertEquals(url -> RepoConfig.hostOf(java.net.URI.create(url)).get, expected, variable)
    assertEquals(SbtCode.maskUserInfo("https://u:pa/ss@bin.example.com/r"), "https://***@bin.example.com/r")

end SbtCodeTest
