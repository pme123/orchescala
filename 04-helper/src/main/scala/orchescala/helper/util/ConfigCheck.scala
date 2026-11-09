package orchescala.helper.util

import scala.util.control.NonFatal

/** Reads the configuration of a helper before a command runs - an error in it (e.g. an invalid
  * `{COMPANY}_MVN_*` variable, see `ReposConfig.artifactoryFromEnv`) is a message for the user,
  * not a stack trace - also if it was thrown while an `object` was initialised.
  */
object ConfigCheck:

  /** The message of the error the configuration throws - None if it can be read. */
  def error(config: => Any): Option[String] =
    try
      config
      None
    catch
      case e: ExceptionInInitializerError => Some(message(e))
      case e: NoClassDefFoundError        => Some(message(e)) // a 2nd access to a failed object
      case NonFatal(e)                    => Some(message(e))

  /** Prints the error of the configuration and stops - nothing if it can be read. */
  def orExit(config: => Any): Unit =
    error(config).foreach: msg =>
      println(s"[error] The configuration of the helper could not be read: $msg")
      sys.exit(1)

  private def message(t: Throwable): String = t match
    case e: (ExceptionInInitializerError | NoClassDefFoundError) if e.getCause != null =>
      message(e.getCause)
    case e                                                                              =>
      Option(e.getMessage).getOrElse(e.toString)

end ConfigCheck
