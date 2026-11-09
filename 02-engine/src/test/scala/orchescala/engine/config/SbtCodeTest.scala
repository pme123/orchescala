package orchescala.engine.config

import munit.FunSuite

import java.util.Locale

class SbtCodeTest extends FunSuite:

  test("a literal escapes quotes and backslashes"):
    assertEquals(SbtCode.literal("""a"b\c"""), """"a\"b\\c"""")

  test("envOrElse: the env variable with the value as fallback - or the value"):
    assertEquals(SbtCode.envOrElse(Some("A_URL"), "https://x"), """sys.env.getOrElse("A_URL", "https://x")""")
    assertEquals(SbtCode.envOrElse(None, """https://x/"y""""), """"https://x/\"y\""""")

  test("the env names of a company: upper case, other characters as _"):
    assertEquals(SbtCode.companyEnvName("acme-bank.ch", "MVN_RELEASE_REPOSITORY"), "ACME_BANK_CH_MVN_RELEASE_REPOSITORY")
    assertEquals(SbtCode.identifier("Acme-Bank.ch"), "acmebankch")

  test("the env names do not depend on the locale (Turkish: i -> İ)"):
    val default = Locale.getDefault
    try
      Locale.setDefault(Locale.forLanguageTag("tr"))
      assertEquals(SbtCode.companyEnvPrefix("orchescalai"), "ORCHESCALAI")
      assertEquals(SbtCode.identifier("ORCHESCALAI"), "orchescalai")
    finally Locale.setDefault(default)

end SbtCodeTest
