import sbt._

import scala.sys.process._

/** npm builds that are part of the sbt build - the DMN Tester UI and the documentation apps
  * (orch-doc, orch-spec) ship in orchescala jars, so nobody has to remember `npm run build`
  * before publishing. See the `bundleClient` / `bundleDocClient` tasks in build.sbt.
  */
object NpmBuild {

  /** Compiling and testing must not need Node.js - a build asks first and keeps the bundle
    * that is there (if any).
    */
  def hasNpm: Boolean =
    try Process("npm --version").!(ProcessLogger(_ => (), _ => ())) == 0
    catch { case _: Exception => false }

  def warnMissingNpm(what: String, clientDir: File, scripts: Seq[String], log: Logger): Unit =
    log.warn(
      (s"npm was not found - $what is NOT rebuilt. Install Node.js, or build it yourself:" +:
        s"  npm --prefix ${clientDir.getName} ci" +:
        scripts.map(s => s"  npm --prefix ${clientDir.getName} run $s")).mkString("\n")
    )

  /** `npm ci` (only if node_modules is missing or broken) and the given npm scripts. */
  def build(what: String, clientDir: File, scripts: Seq[String], log: Logger, env: (String, String)*): Unit = {
    // install WITHOUT NODE_ENV=production - npm would omit the devDependencies, and vite is
    // one of them. `.bin/vite` is what the build needs, so a broken or partial node_modules
    // is repaired as well.
    if (!(clientDir / "node_modules" / ".bin" / "vite").exists())
      run(what, "npm ci", clientDir, log)
    scripts.foreach(s => run(what, s"npm run $s", clientDir, log, env: _*))
  }

  def run(what: String, command: String, cwd: File, log: Logger, env: (String, String)*): Unit = {
    log.info(s"$what: $command (in $cwd)")
    val exitCode = Process(command, cwd, env: _*) ! log
    if (exitCode != 0)
      sys.error(s"'$command' failed in $cwd (exit code $exitCode)")
  }
}
