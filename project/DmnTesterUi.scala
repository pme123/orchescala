import sbt.*

import scala.sys.process.*

/** The DMN Tester's UI is a Scala.js + vite app that `orchescala-dmntester-server`
  * ships in its jar - so the vite build is part of the sbt build: nobody has to
  * remember `npm run build` before publishing.
  *
  * Used by the `bundleClient` task (see build.sbt), which links the Scala.js
  * output first and caches the build.
  */
object DmnTesterUi {

  /** Compiling and testing the server must not need Node.js - so a build asks
    * first and keeps the bundle that is there (if any).
    */
  def hasNpm: Boolean =
    try Process("npm --version").!(ProcessLogger(_ => (), _ => ())) == 0
    catch { case _: Exception => false }

  def warnMissingNpm(clientDir: File, log: Logger): Unit =
    log.warn(
      s"""npm was not found - the DMN Tester UI is NOT rebuilt.
         |Install Node.js, or build the UI yourself:
         |  npm --prefix ${clientDir.getName} ci
         |  npm --prefix ${clientDir.getName} run build""".stripMargin
    )

  def build(clientDir: File, log: Logger): Unit = {
    if (!(clientDir / "node_modules").isDirectory) run("npm ci", clientDir, log)
    run("npm run build", clientDir, log)
  }

  private def run(command: String, cwd: File, log: Logger): Unit = {
    log.info(s"DMN Tester UI: $command (in $cwd)")
    // NODE_ENV selects the fullLinkJS output - see vite.config.js
    val exitCode = Process(command, cwd, "NODE_ENV" -> "production") ! log
    if (exitCode != 0)
      sys.error(s"'$command' failed in $cwd (exit code $exitCode)")
  }
}
