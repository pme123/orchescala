package orchescala.engine.config

import munit.FunSuite


class SbtCodeTest extends FunSuite:

  test("a literal escapes quotes and backslashes"):
    assertEquals(SbtCode.literal("""a"b\c"""), """"a\"b\\c"""")

  test("envOrElse: the env variable with the value as fallback - or the value"):
    assertEquals(SbtCode.envOrElse(Some("A_URL"), "https://x"), """sys.env.get("A_URL").filter(_.trim.nonEmpty).getOrElse("https://x")""")
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
    assertEquals(SbtCode.envValue("A_URL"), """sys.env.get("A_URL").filter(_.trim.nonEmpty)""")

end SbtCodeTest
