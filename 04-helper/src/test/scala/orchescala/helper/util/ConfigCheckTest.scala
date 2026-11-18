package orchescala.helper.util

import munit.FunSuite

import java.io.ByteArrayOutputStream

/** A company config as a top-level object - its initialisation fails: the 1st access throws an
  * `ExceptionInInitializerError`, every further one a `NoClassDefFoundError` (a nested object
  * would throw the `IllegalArgumentException` itself each time).
  */
object BrokenTopLevelCompanyConfig:
  val repos: String = throw IllegalArgumentException("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")

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
    assert(ConfigCheck.orExit("config", _ => ()))
    // with an exit that does not stop: false - the caller does not run the command
    assert(!ConfigCheck.orExit(brokenLazyConfig, _ => ()))

  test("the message of an error in a lazy val"):
    assertEquals(
      ConfigCheck.error(brokenLazyConfig),
      Some("ACME_MVN_RELEASE_REPOSITORY is no http(s) url: x")
    )

  test("the message of an error while an object is initialised"):
    // the 1st access: ExceptionInInitializerError with the cause - on every JDK
    assertEquals(
      ConfigCheck.error(BrokenTopLevelCompanyConfig.repos),
      Some("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")
    )

  test("the message at a further access to the failed object (JDK 18+)"):
    // JDK 18+ gives the cause of a NoClassDefFoundError as text - before it has none, then it is
    // the safe branch (message + stack trace); in the helpers `orExit` is the 1st access.
    // Checked on JDK 21.0.12 (Temurin) and 25.0.2 - another wording also falls back to the
    // stack trace.
    assume(Runtime.version.feature >= 18, "the replayed cause is JDK 18+")
    val expected = Some("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")
    val _        = ConfigCheck.error(BrokenTopLevelCompanyConfig.repos) // 1st access, if not yet
    assertEquals(ConfigCheck.error(BrokenTopLevelCompanyConfig.repos), expected)
    // and no stack trace - it is an invalid value
    val (out, err, exits) = runOrExit(BrokenTopLevelCompanyConfig.repos)
    assert(out.contains("has no host: https:///x"), out)
    assertEquals(err, "")
    assertEquals(exits, Seq(1))

  test("a nested object throws the error itself each time"):
    assertEquals(
      ConfigCheck.error(BrokenCompanyConfig.repos),
      Some("ACME_MVN_RELEASE_REPOSITORY has no host: https:///x")
    )

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

  test("a class missing on the classpath is no configuration error - it is thrown"):
    // the message of a missing class is its name - not "Could not initialize class ..."
    // (munit's intercept does not catch a LinkageError)
    val thrown =
      try
        ConfigCheck.error(throw NoClassDefFoundError("acme/orchescala/Missing"))
        None
      catch case e: NoClassDefFoundError => Some(e.getMessage)
    assertEquals(thrown, Some("acme/orchescala/Missing"))

end ConfigCheckTest
