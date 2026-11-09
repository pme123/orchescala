package orchescala.helper.util

import munit.FunSuite

/** An invalid configuration must reach the user as its message - not as an
  * `ExceptionInInitializerError`.
  */
class ConfigCheckTest extends FunSuite:

  private object BrokenCompanyConfig:
    val repos: String = throw IllegalArgumentException("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")

  private lazy val brokenLazyConfig: String =
    throw IllegalArgumentException("ACME_MVN_RELEASE_REPOSITORY is no http(s) url: x")

  test("a configuration that can be read - no error"):
    assertEquals(ConfigCheck.error("config"), None)

  test("the message of an error in a lazy val"):
    assertEquals(
      ConfigCheck.error(brokenLazyConfig),
      Some("ACME_MVN_RELEASE_REPOSITORY is no http(s) url: x")
    )

  test("the message of an error while an object is initialised - also at the 2nd access"):
    val expected = Some("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")
    assertEquals(ConfigCheck.error(BrokenCompanyConfig.repos), expected)
    // the 2nd access throws NoClassDefFoundError - with the cause on current JDKs
    assert(ConfigCheck.error(BrokenCompanyConfig.repos).nonEmpty)

end ConfigCheckTest
