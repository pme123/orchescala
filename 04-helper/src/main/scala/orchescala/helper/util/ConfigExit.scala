package orchescala.helper.util

/** How a helper stops on an invalid configuration (see `ConfigCheck.orExit`) - override it to
  * run the helper in-process; the command is not run then either.
  */
trait ConfigExit:
  protected def exitOnInvalidConfig(code: Int): Unit = sys.exit(code)
