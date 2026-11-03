package orchescala.helper.dev.update.merge

import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Try

/** The tools the merge runs (node, git, tar) - with a timeout: a tool that hangs (git waiting for
  * a credential, a script in an endless loop) ends the merge with an error instead of blocking the
  * helper.
  */
object ExternalTool:

  /** Orch Spec's tools over a whole spec folder - generous, a big spec takes some seconds. */
  val nodeTimeout: FiniteDuration = 5.minutes

  /** git and tar on the local repository. */
  val gitTimeout: FiniteDuration = 1.minute

  /** `node --version` - is Node.js there at all. */
  val probeTimeout: FiniteDuration = 30.seconds

  /** Runs the command - its result whatever the exit code; `ToolTimeout` if it did not finish in
    * time: then it is stopped with all the processes it started.
    */
  def call(
      command: Seq[String],
      timeout: FiniteDuration,
      cwd: os.Path = null,
      stdin: os.ProcessInput = os.Pipe
  ): os.CommandResult =
    val chunks = ConcurrentLinkedQueue[Either[geny.Bytes, geny.Bytes]]()
    def collect(chunk: geny.Bytes => Either[geny.Bytes, geny.Bytes]) =
      os.ProcessOutput.ReadBytes((buf, n) => chunks.add(chunk(geny.Bytes(java.util.Arrays.copyOf(buf, n)))))
    val sub    = os.proc(command).spawn(cwd = cwd, stdin = stdin, stdout = collect(Left(_)), stderr = collect(Right(_)))
    if !sub.waitFor(timeout.toMillis) then
      stopAll(sub.wrapped.toHandle)
      // what it said until then - for git waiting for a credential the only hint
      val said = String(chunks.iterator.asScala.flatMap(_.fold(identity, identity).array).toArray, "UTF-8")
      throw ToolTimeout(command.head, timeout, said.takeRight(outputTail).trim)
    sub.join() // the output read to its end
    os.CommandResult(command, sub.exitCode(), chunks.iterator.asScala.toIndexedSeq)
  end call

  /** Stops the process and everything it started (`sh -c`, git's helpers, node's children). The
    * descendants are taken before: once the process is gone, its children belong to another one.
    */
  private def stopAll(process: ProcessHandle): Unit =
    val all = process +: process.descendants().iterator.asScala.toSeq
    all.foreach(_.destroyForcibly())
    // a process that does not end (stuck in IO) must not hide the timeout
    all.foreach(p => Try(p.onExit().get(5, java.util.concurrent.TimeUnit.SECONDS)))
  end stopAll

  /** How much of a stopped tool's output its ToolTimeout shows - the end of it. */
  private val outputTail = 2000

end ExternalTool

/** A tool of the merge did not finish within its timeout.
  * @param output the end of what it wrote (stdout and stderr) until it was stopped
  */
case class ToolTimeout(tool: String, timeout: FiniteDuration, output: String = "")
    extends RuntimeException(
      s"$tool did not finish within $timeout - stopped." + (if output.isEmpty then "" else s" Its output:\n$output")
    )
