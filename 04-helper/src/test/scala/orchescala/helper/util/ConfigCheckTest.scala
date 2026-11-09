package orchescala.helper.util

import munit.FunSuite

import java.io.ByteArrayOutputStream

/** An invalid configuration must reach the user as its message - not as an
  * `ExceptionInInitializerError`; a bug in it with its stack trace.
  */
class ConfigCheckTest extends FunSuite:

  private object BrokenCompanyConfig:
    val repos: String = throw IllegalArgumentException("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")

  private lazy val brokenLazyConfig: String =
    throw IllegalArgumentException("ACME_MVN_RELEASE_REPOSITORY is no http(s) url: x")

  private lazy val buggyConfig: String =
    val missing: String = null
    missing.trim

  /** stdout, stderr and the exit codes of `orExit` */
  private def runOrExit(config: => Any): (String, String, Seq[Int]) =
    val out   = ByteArrayOutputStream()
    val err   = ByteArrayOutputStream()
    var exits = Seq.empty[Int]
    Console.withOut(out):
      Console.withErr(err):
        ConfigCheck.orExit(config, code => exits :+= code)
    (out.toString, err.toString, exits)

  test("a configuration that can be read - no error"):
    assertEquals(ConfigCheck.error("config"), None)
    assertEquals(runOrExit("config"), ("", "", Seq.empty))

  test("the message of an error in a lazy val"):
    assertEquals(
      ConfigCheck.error(brokenLazyConfig),
      Some("ACME_MVN_RELEASE_REPOSITORY is no http(s) url: x")
    )

  test("the message of an error while an object is initialised - also at the 2nd access"):
    assertEquals(
      ConfigCheck.error(BrokenCompanyConfig.repos),
      Some("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")
    )
    // the 2nd access throws NoClassDefFoundError - with the cause on current JDKs
    assert(ConfigCheck.error(BrokenCompanyConfig.repos).nonEmpty)

  test("orExit: an invalid value - the message, no stack trace, exit 1"):
    val (out, err, exits) = runOrExit(brokenLazyConfig)
    assertEquals(
      out.trim,
      "[error] The configuration of the helper could not be read: ACME_MVN_RELEASE_REPOSITORY is no http(s) url: x"
    )
    assertEquals(err, "")
    assertEquals(exits, Seq(1))

  test("orExit: a bug in the configuration - with its stack trace"):
    val (out, err, exits) = runOrExit(buggyConfig)
    assert(out.startsWith("[error] The configuration of the helper could not be read: "), out)
    assert(err.contains("java.lang.NullPointerException"), err)
    assert(err.contains("ConfigCheckTest"), err)
    assertEquals(exits, Seq(1))

end ConfigCheckTest
