package orchescala.helper.util

import java.io.{PrintWriter, StringWriter}
import scala.util.control.NonFatal

/** Reads the configuration of a helper before a command runs. An invalid value (an
  * `IllegalArgumentException`, e.g. of an invalid `{COMPANY}_MVN_*` variable - see
  * `ReposConfig.artifactoryFromEnv`) is a message for the user; any other error is a bug in the
  * configuration and comes with its stack trace. Both also if thrown while an `object` was
  * initialised.
  */
object ConfigCheck:

  /** The error the configuration throws - the cause of an `ExceptionInInitializerError`. */
  def failure(config: => Any): Option[Throwable] =
    try
      config
      None
    catch
      case e: ExceptionInInitializerError                   => Some(cause(e))
      // only a 2nd access to a failed object - not a class missing on the classpath
      case e: NoClassDefFoundError if failedObject(e)       => Some(cause(e))
      case NonFatal(e)                                      => Some(cause(e))

  /** The message of the error the configuration throws - None if it can be read. */
  def error(config: => Any): Option[String] =
    failure(config).map(e => invalidValue(e).getOrElse(message(e)))

  /** Prints the error of the configuration (with the stack trace if it is no invalid value) and
    * stops - nothing if it can be read.
    */
  def orExit(config: => Any, exit: Int => Unit = code => sys.exit(code)): Unit =
    failure(config).foreach: e =>
      invalidValue(e) match
        case Some(msg) => // an invalid value - the message says it
          println(s"[error] The configuration of the helper could not be read: $msg")
        case None      =>
          println(s"[error] The configuration of the helper could not be read: ${message(e)}")
          Console.err.println(stackTrace(e))
      exit(1)

  // the JDK's message for a class whose initialisation failed before (since JDK 8)
  private def failedObject(e: NoClassDefFoundError): Boolean =
    Option(e.getMessage).exists(_.startsWith("Could not initialize class"))

  private def cause(t: Throwable): Throwable = t match
    case e: (ExceptionInInitializerError | NoClassDefFoundError) if e.getCause != null =>
      cause(e.getCause)
    case e                                                                              => e

  /** The message of an invalid value: an `IllegalArgumentException` - also the copy of one, that
    * a 2nd access to a failed object gives on a JDK 18+ (`NoClassDefFoundError` with an
    * `ExceptionInInitializerError` that has only the text: `Exception <class>: <message> [in
    * thread "..."]`).
    */
  private def invalidValue(t: Throwable): Option[String] = t match
    case e: IllegalArgumentException    => Some(message(e))
    case e: ExceptionInInitializerError =>
      Option(e.getMessage).collect:
        case Replayed("java.lang.IllegalArgumentException", msg) => msg
    case _                              => None

  private val Replayed = """(?s)Exception (\S+?): (.*) \[in thread ".*"\]""".r

  private def message(t: Throwable): String =
    Option(t.getMessage).getOrElse(t.toString)

  private def stackTrace(t: Throwable): String =
    val writer = StringWriter()
    t.printStackTrace(PrintWriter(writer))
    writer.toString

end ConfigCheck
