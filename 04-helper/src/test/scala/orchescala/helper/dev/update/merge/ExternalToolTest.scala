package orchescala.helper.dev.update.merge

import munit.FunSuite

import scala.concurrent.duration.*

/** The tools of the merge with a timeout. */
class ExternalToolTest extends FunSuite:

  test("a tool that finishes in time: its result, whatever the exit code"):
    val ok = ExternalTool.call(Seq("sh", "-c", "echo hi; echo oops >&2"), 10.seconds)
    assertEquals((ok.exitCode, ok.out.trim(), ok.err.trim()), (0, "hi", "oops"))
    assertEquals(ExternalTool.call(Seq("sh", "-c", "exit 3"), 10.seconds).exitCode, 3)
    // an environment of its own - added to the inherited one
    val env = ExternalTool.call(Seq("sh", "-c", "echo $GIT_TERMINAL_PROMPT-$HOME"), 10.seconds, env = Map("GIT_TERMINAL_PROMPT" -> "0"))
    assertEquals(env.out.trim(), s"0-${sys.env("HOME")}")
    // a failing tool that takes its time is no timeout - only one that still runs at the deadline
    assertEquals(ExternalTool.call(Seq("sh", "-c", "sleep 0.3; exit 4"), 5.seconds).exitCode, 4)

  test("a tool that hangs: stopped at its timeout - ToolTimeout"):
    val start   = System.nanoTime()
    val timeout = intercept[ToolTimeout](ExternalTool.call(Seq("sleep", "30"), 300.millis))
    assertEquals(timeout.tool, "sleep")
    assert((System.nanoTime() - start).nanos < 10.seconds, "not stopped")

  test("a tool that hangs: its ToolTimeout shows what it wrote until then"):
    val timeout = intercept[ToolTimeout]:
      ExternalTool.call(Seq("sh", "-c", "echo 'Username for https://example.com:' >&2; sleep 30"), 3.seconds)
    assertEquals(timeout.output, "Username for https://example.com:")
    assert(timeout.getMessage.endsWith("Its output:\nUsername for https://example.com:"), timeout.getMessage)

  test("a tool that hangs: what it started is stopped too"):
    val pidFile = os.temp()
    intercept[ToolTimeout]:
      ExternalTool.call(Seq("sh", "-c", s"sleep 30 & echo $$! > '$pidFile'; wait"), 3.seconds)
    val child   = ProcessHandle.of(os.read(pidFile).trim.toLong)
    assert(!child.map(_.isAlive).orElse(false), "the child of the tool still runs")

  test("a tool that ended while a process it started still holds its output: ToolTimeout, no hang, the process stopped"):
    val start   = System.nanoTime()
    val pidFile = os.temp()
    val timeout = intercept[ToolTimeout]:
      ExternalTool.call(Seq("sh", "-c", s"echo started; sleep 60 & echo $$! > '$pidFile'; sleep 1; exit 0"), 5.seconds)
    assert(timeout.getMessage.contains("still held its output - stopped"), timeout.getMessage)
    assertEquals(timeout.output, "started")
    assert((System.nanoTime() - start).nanos < 30.seconds, "it hung")
    val child   = ProcessHandle.of(os.read(pidFile).trim.toLong)
    assert(!child.map(_.isAlive).orElse(false), "the process left behind still runs")

  test("a process the tool started that let its output go keeps running"):
    val pidFile = os.temp()
    ExternalTool.call(Seq("sh", "-c", s"sleep 30 > /dev/null 2>&1 & echo $$! > '$pidFile'; sleep 0.3"), 10.seconds)
    val daemon  = ProcessHandle.of(os.read(pidFile).trim.toLong)
    assert(daemon.map(_.isAlive).orElse(false), "a daemon of the tool was stopped")
    daemon.ifPresent(_.destroyForcibly())

  test("a tool without an input: its input is closed - one that reads it does not wait"):
    val start = System.nanoTime()
    val cat   = ExternalTool.call(Seq("cat"), 30.seconds)
    assertEquals(cat.exitCode -> cat.out.text(), 0 -> "")
    assert((System.nanoTime() - start).nanos < 20.seconds, "it waited for its input")
    assertEquals(ExternalTool.call(Seq("cat"), 30.seconds, stdin = "given").out.text(), "given")

  test("the output in a ToolTimeout: a URL without its user or token"):
    assertEquals(
      ExternalTool.withoutCredentials("fatal: https://pat:ghp_x1@github.com/a/b.git and ssh://git@host/c"),
      "fatal: https://***@github.com/a/b.git and ssh://***@host/c"
    )
    // masked before it is cut: the end of a long output with a URL in it
    val timeout = intercept[ToolTimeout]:
      ExternalTool.call(Seq("sh", "-c", "printf 'https://pat:secret@github.com/x'; head -c 1990 /dev/zero | tr '\\0' x; sleep 30"), 3.seconds)
    assert(!timeout.output.contains("secret"), timeout.output.take(80))

  test("reading the output fails midway: no result - its error"):
    val chunks  = java.util.concurrent.ConcurrentLinkedQueue[Either[geny.Bytes, geny.Bytes]]()
    val cutOff  = new java.io.InputStream:
      private var sent = false
      def read(): Int  = throw java.io.IOException("cut off")
      override def read(b: Array[Byte]): Int =
        if sent then throw java.io.IOException("cut off")
        sent = true
        b(0) = 'x'.toByte
        1
    val reading = ExternalTool.read(cutOff, Left(_), chunks)
    reading.thread.join(5000)
    assertEquals(reading.failure.map(_.getMessage), Some("cut off"))
    assertEquals(chunks.size, 1)

end ExternalToolTest
