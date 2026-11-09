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
      case e: ExceptionInInitializerError => Some(cause(e))
      case e: NoClassDefFoundError        => Some(cause(e)) // a 2nd access to a failed object
      case NonFatal(e)                    => Some(cause(e))

  /** The message of the error the configuration throws - None if it can be read. */
  def error(config: => Any): Option[String] =
    failure(config).map(message)

  /** Prints the error of the configuration (with the stack trace if it is no invalid value) and
    * stops - nothing if it can be read.
    */
  def orExit(config: => Any, exit: Int => Unit = code => sys.exit(code)): Unit =
    failure(config).foreach: e =>
      println(s"[error] The configuration of the helper could not be read: ${message(e)}")
      e match
        case _: IllegalArgumentException => // an invalid value - the message says it
        case other                       => Console.err.println(stackTrace(other))
      exit(1)

  private def cause(t: Throwable): Throwable = t match
    case e: (ExceptionInInitializerError | NoClassDefFoundError) if e.getCause != null =>
      cause(e.getCause)
    case e                                                                              => e

  private def message(t: Throwable): String =
    Option(t.getMessage).getOrElse(t.toString)

  private def stackTrace(t: Throwable): String =
    val writer = StringWriter()
    t.printStackTrace(PrintWriter(writer))
    writer.toString

end ConfigCheck
