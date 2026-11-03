package orchescala.helper.dev.update.merge

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicReference
import scala.collection.mutable
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Try
import scala.util.control.NonFatal

/** The tools the merge runs (node, git, tar) - with a timeout: a tool that hangs (git waiting for
  * a credential, a script in an endless loop) ends the merge with an error instead of blocking the
  * helper.
  */
object ExternalTool:

  /** Orch Spec's tools over a whole spec folder - generous, a big spec takes some seconds. */
  val nodeTimeout: FiniteDuration = 5.minutes

  /** git and tar on the local repository. */
  val gitTimeout: FiniteDuration = 1.minute

  /** Orch Spec's comparison of the spec - optional: not worth waiting as long as for the export. */
  val diffTimeout: FiniteDuration = 1.minute

  /** `node --version` - is Node.js there at all. */
  val probeTimeout: FiniteDuration = 30.seconds

  /** Runs the command - its result whatever the exit code; `ToolTimeout` if it did not finish in
    * time - the tool and reading its output under one deadline: a tool still running is stopped
    * with the processes it started, as far as they are found (see `started`); a tool that ended
    * while a process it started still holds its output (a credential helper, a child in the
    * background) is no result either. Without an input (`os.Pipe`) the tool's input is closed -
    * a tool reading it does not wait. An input is given in a thread of its own (os-lib). The
    * timeout is the tool's: stopping it and reading the rest of its output take a few seconds more
    * (`stopWait`, `drainTime`).
    */
  def call(
      command: Seq[String],
      timeout: FiniteDuration,
      cwd: os.Path = null,
      stdin: os.ProcessInput = os.Pipe,
      env: Map[String, String] = null
  ): os.CommandResult =
    val deadline = System.nanoTime() + timeout.toNanos
    def left     = math.max(1L, (deadline - System.nanoTime()) / 1000000)
    val chunks   = ConcurrentLinkedQueue[Either[geny.Bytes, geny.Bytes]]()
    val sub      = os.proc(command).spawn(cwd = cwd, env = env, stdin = stdin, stdout = os.Pipe, stderr = os.Pipe)
    val readers  = Seq(
      read(sub.wrapped.getInputStream, Left(_), chunks),
      read(sub.wrapped.getErrorStream, Right(_), chunks)
    )
    def timedOut(how: String) =
      // what it said until then - for git waiting for a credential the only hint
      val said = String(chunks.iterator.asScala.flatMap(_.fold(identity, identity).array).toArray, "UTF-8")
      // masked before it is cut: a URL cut in the middle would keep its token
      ToolTimeout(command.head, timeout, withoutCredentials(said).takeRight(outputTail).trim, how)
    // the processes the tool started, as seen while it ran - once it has ended, the ones left
    // behind belong to another parent and can no longer be found from it. Best effort: one that
    // lives shorter than a look (50 to 500 ms) and leaves a child behind is missed - the call still ends
    // with a ToolTimeout, the child keeps running.
    val started  = mutable.LinkedHashSet.empty[ProcessHandle]
    try
      if stdin eq os.Pipe then sub.stdin.close()
      var ended = false
      var step  = watchStep
      while !ended && System.nanoTime() < deadline do
        sub.wrapped.toHandle.descendants().forEach(started += _)
        ended = sub.waitFor(math.min(step, left))
        step = math.min(step * 2, maxWatchStep) // a long run is looked at less often
      if !ended then
        // stopped first, with what it started as seen - then what it wrote up to its end is read
        stopAll(sub.wrapped.toHandle +: started.filter(_.isAlive).toSeq*)
        readers.foreach(_.thread.join(stopWait.toMillis))
        throw timedOut("stopped")
      // the rest of the output: a time of its own - a tool that ended just before its deadline
      // may still have a big output in the pipe
      val drained = System.nanoTime() + drainTime.toNanos
      readers.foreach(r => r.thread.join(math.max(1L, (drained - System.nanoTime()) / 1000000)))
      // a process left behind still holds the output: it is stopped, then the readers end too;
      // a process the tool started that let its output go (a daemon of git) keeps running
      if readers.exists(_.thread.isAlive) then
        stopAll(started.filter(_.isAlive).toSeq*)
        readers.foreach(_.thread.join(stopWait.toMillis))
        throw timedOut("it ended, but a process it started still held its output - stopped")
      // a half-read output is no result - a git archive cut off would look complete
      readers.flatMap(_.failure).headOption.foreach: e =>
        throw java.io.IOException(s"${command.head}: reading its output failed - ${e.getMessage}", e)
      os.CommandResult(command, sub.exitCode(), chunks.iterator.asScala.toIndexedSeq)
    finally
      // whatever else ended the call (an interrupt, an error): the tool and what it started are stopped
      if sub.isAlive() then stopAll(sub.wrapped.toHandle +: started.filter(_.isAlive).toSeq*)
      // a stream still read is left to its daemon - closing it could block on the reader's lock
      if !readers.exists(_.thread.isAlive) then
        Try(sub.wrapped.getInputStream.close())
        Try(sub.wrapped.getErrorStream.close())
    end try
  end call

  /** A stream read in a daemon thread - and why the reading failed, if it did. */
  private[merge] final class Reading(val thread: Thread, error: AtomicReference[Throwable]):
    def failure: Option[Throwable] = Option(error.get)

  /** Reads the stream to its end into `chunks`. */
  private[merge] def read(
      in: java.io.InputStream,
      as: geny.Bytes => Either[geny.Bytes, geny.Bytes],
      chunks: ConcurrentLinkedQueue[Either[geny.Bytes, geny.Bytes]]
  ): Reading =
    val error             = AtomicReference[Throwable]()
    val reading: Runnable = () =>
      try
        val buf = new Array[Byte](8192)
        var n   = in.read(buf)
        while n >= 0 do
          if n > 0 then chunks.add(as(geny.Bytes(java.util.Arrays.copyOf(buf, n))))
          n = in.read(buf)
      catch case NonFatal(e) => error.set(e)
    val thread            = Thread(reading)
    thread.setDaemon(true)
    thread.start()
    Reading(thread, error)
  end read

  /** Stops the processes and what they started that is still theirs (`sh -c`, git's helpers,
    * node's children). The descendants are taken before: once a process is gone, its children
    * belong to another one.
    */
  private def stopAll(processes: ProcessHandle*): Unit =
    val all   = processes.flatMap(p => p +: p.descendants().iterator.asScala.toSeq).distinct
    all.foreach(_.destroyForcibly())
    // waited for together, a few seconds at most - a process that does not end (stuck in IO)
    // must not hide the timeout
    val until = System.nanoTime() + stopWait.toNanos
    all.foreach(p => Try(p.onExit().get(math.max(0L, until - System.nanoTime()), java.util.concurrent.TimeUnit.NANOSECONDS)))
  end stopAll

  /** A URL with a user or token (`https://user:token@host`) - shown without them. */
  def withoutCredentials(text: String): String =
    text.replaceAll("""://[^/\s@]+@""", "://***@")

  /** How much of a stopped tool's output its ToolTimeout shows - the end of it. */
  private val outputTail = 2000

  /** How long the stopped processes are waited for, together. */
  private val stopWait = 5.seconds

  /** How often the processes a running tool started are looked at (milliseconds) - at first,
    * then less often up to `maxWatchStep`.
    */
  private val watchStep    = 50L
  private val maxWatchStep = 500L

  /** How long the output of a tool that ended is read to its end. */
  private val drainTime = 10.seconds

end ExternalTool

/** A tool of the merge did not finish within its timeout.
  * @param output the end of what it wrote (stdout and stderr) until it was stopped
  */
case class ToolTimeout(tool: String, timeout: FiniteDuration, output: String = "", how: String = "stopped")
    extends RuntimeException(
      s"$tool did not finish within $timeout - $how." + (if output.isEmpty then "" else s" Its output:\n$output")
    )
