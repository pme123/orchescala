package orchescala.helper.dev.update.merge

import scala.concurrent.duration.*

/** The tools the merge runs (node, git, tar) - with a timeout: a tool that hangs (git waiting for
  * a credential, a script in an endless loop) ends the merge with an error instead of blocking the
  * helper.
  */
object ExternalTool:

  /** Orch Spec's tools over a whole spec folder - generous, a big spec takes some seconds. */
  val nodeTimeout: FiniteDuration = 5.minutes

  /** git and tar on the local repository. */
  val gitTimeout: FiniteDuration = 1.minute

  /** Runs the command - its result whatever the exit code; `ToolTimeout` if it did not finish in
    * time (it is stopped then).
    */
  def call(
      command: Seq[String],
      timeout: FiniteDuration,
      cwd: os.Path = null,
      stdin: os.ProcessInput = os.Pipe
  ): os.CommandResult =
    val start  = System.nanoTime()
    val result = os.proc(command).call(cwd = cwd, stdin = stdin, check = false, stderr = os.Pipe, timeout = timeout.toMillis)
    // os-lib stops a process at its timeout and gives its exit code - the time tells it apart
    if result.exitCode != 0 && (System.nanoTime() - start).nanos >= timeout then
      throw ToolTimeout(command.head, timeout)
    result
  end call

end ExternalTool

/** A tool of the merge did not finish within its timeout. */
case class ToolTimeout(tool: String, timeout: FiniteDuration)
    extends RuntimeException(s"$tool did not finish within $timeout - stopped.")
