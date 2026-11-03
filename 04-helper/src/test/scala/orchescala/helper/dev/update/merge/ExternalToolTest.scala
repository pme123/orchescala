package orchescala.helper.dev.update.merge

import munit.FunSuite

import scala.concurrent.duration.*

/** The tools of the merge with a timeout. */
class ExternalToolTest extends FunSuite:

  test("a tool that finishes in time: its result, whatever the exit code"):
    val ok = ExternalTool.call(Seq("sh", "-c", "echo hi; echo oops >&2"), 10.seconds)
    assertEquals((ok.exitCode, ok.out.trim(), ok.err.trim()), (0, "hi", "oops"))
    assertEquals(ExternalTool.call(Seq("sh", "-c", "exit 3"), 10.seconds).exitCode, 3)
    // a failing tool that takes its time is no timeout - only one that still runs at the deadline
    assertEquals(ExternalTool.call(Seq("sh", "-c", "sleep 0.3; exit 4"), 5.seconds).exitCode, 4)

  test("a tool that hangs: stopped at its timeout - ToolTimeout"):
    val start   = System.nanoTime()
    val timeout = intercept[ToolTimeout](ExternalTool.call(Seq("sleep", "30"), 300.millis))
    assertEquals(timeout.tool, "sleep")
    assert((System.nanoTime() - start).nanos < 10.seconds, "not stopped")

  test("a tool that hangs: its ToolTimeout shows what it wrote until then"):
    val timeout = intercept[ToolTimeout]:
      ExternalTool.call(Seq("sh", "-c", "echo 'Username for https://example.com:' >&2; sleep 30"), 1.second)
    assertEquals(timeout.output, "Username for https://example.com:")
    assert(timeout.getMessage.endsWith("Its output:\nUsername for https://example.com:"), timeout.getMessage)

  test("a tool that hangs: what it started is stopped too"):
    val pidFile = os.temp()
    intercept[ToolTimeout]:
      ExternalTool.call(Seq("sh", "-c", s"sleep 30 & echo $$! > '$pidFile'; wait"), 1.second)
    val child   = ProcessHandle.of(os.read(pidFile).trim.toLong)
    assert(!child.map(_.isAlive).orElse(false), "the child of the tool still runs")

  test("a tool that ended while a process it started still holds its output: ToolTimeout, no hang"):
    val start   = System.nanoTime()
    val timeout = intercept[ToolTimeout](ExternalTool.call(Seq("sh", "-c", "echo started; sleep 60 & exit 0"), 2.seconds))
    assert(timeout.getMessage.contains("still holds its output"), timeout.getMessage)
    assertEquals(timeout.output, "started")
    assert((System.nanoTime() - start).nanos < 30.seconds, "it hung")

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
