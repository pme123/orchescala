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
    * time - the tool and reading its output under one deadline: a tool still running is stopped
    * with all the processes it started; a tool that ended while a process it started still holds
    * its output (a credential helper, a child in the background) is no result either. Without an
    * input (`os.Pipe`) the tool's input is closed - a tool reading it does not wait.
    */
  def call(
      command: Seq[String],
      timeout: FiniteDuration,
      cwd: os.Path = null,
      stdin: os.ProcessInput = os.Pipe
  ): os.CommandResult =
    val deadline = System.nanoTime() + timeout.toNanos
    def left     = math.max(1L, (deadline - System.nanoTime()) / 1000000)
    val chunks   = ConcurrentLinkedQueue[Either[geny.Bytes, geny.Bytes]]()
    val sub      = os.proc(command).spawn(cwd = cwd, stdin = stdin, stdout = os.Pipe, stderr = os.Pipe)
    if stdin eq os.Pipe then sub.stdin.close()
    val readers  = Seq(read(sub.wrapped.getInputStream, Left(_), chunks), read(sub.wrapped.getErrorStream, Right(_), chunks))
    def timedOut(how: String) =
      // what it said until then - for git waiting for a credential the only hint
      val said = String(chunks.iterator.asScala.flatMap(_.fold(identity, identity).array).toArray, "UTF-8")
      ToolTimeout(command.head, timeout, withoutCredentials(said.takeRight(outputTail)).trim, how)
    if !sub.waitFor(left) then
      stopAll(sub.wrapped.toHandle)
      throw timedOut("stopped")
    readers.foreach(_.join(left))
    // the readers are daemons: one blocked on a pipe held by a process left behind does not keep the helper
    if readers.exists(_.isAlive) then throw timedOut("it ended, but a process it started still holds its output")
    os.CommandResult(command, sub.exitCode(), chunks.iterator.asScala.toIndexedSeq)
  end call

  /** Reads the stream to its end into `chunks` - in a daemon thread. */
  private def read(
      in: java.io.InputStream,
      as: geny.Bytes => Either[geny.Bytes, geny.Bytes],
      chunks: ConcurrentLinkedQueue[Either[geny.Bytes, geny.Bytes]]
  ): Thread =
    val reading: Runnable = () =>
      Try:
        val buf = new Array[Byte](8192)
        var n   = in.read(buf)
        while n >= 0 do
          if n > 0 then chunks.add(as(geny.Bytes(java.util.Arrays.copyOf(buf, n))))
          n = in.read(buf)
    val thread            = Thread(reading)
    thread.setDaemon(true)
    thread.start()
    thread
  end read

  /** Stops the process and everything it started (`sh -c`, git's helpers, node's children). The
    * descendants are taken before: once the process is gone, its children belong to another one.
    */
  private def stopAll(process: ProcessHandle): Unit =
    val all   = process +: process.descendants().iterator.asScala.toSeq
    all.foreach(_.destroyForcibly())
    // waited for together, a few seconds at most - a process that does not end (stuck in IO)
    // must not hide the timeout
    val until = System.nanoTime() + stopWait.toNanos
    all.foreach(p => Try(p.onExit().get(math.max(0L, until - System.nanoTime()), java.util.concurrent.TimeUnit.NANOSECONDS)))
  end stopAll

  /** A URL with a user or token (`https://user:token@host`) - shown without them. */
  private[merge] def withoutCredentials(text: String): String =
    text.replaceAll("""://[^/\s@]+@""", "://***@")

  /** How much of a stopped tool's output its ToolTimeout shows - the end of it. */
  private val outputTail = 2000

  /** How long the stopped processes are waited for, together. */
  private val stopWait = 5.seconds

end ExternalTool

/** A tool of the merge did not finish within its timeout.
  * @param output the end of what it wrote (stdout and stderr) until it was stopped
  */
case class ToolTimeout(tool: String, timeout: FiniteDuration, output: String = "", how: String = "stopped")
    extends RuntimeException(
      s"$tool did not finish within $timeout - $how." + (if output.isEmpty then "" else s" Its output:\n$output")
    )
