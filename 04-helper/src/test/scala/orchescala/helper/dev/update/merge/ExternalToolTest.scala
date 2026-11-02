package orchescala.helper.dev.update.merge

import munit.FunSuite

import scala.concurrent.duration.*

/** The tools of the merge with a timeout. */
class ExternalToolTest extends FunSuite:

  test("a tool that finishes in time: its result, whatever the exit code"):
    val ok = ExternalTool.call(Seq("sh", "-c", "echo hi"), 10.seconds)
    assertEquals(ok.exitCode -> ok.out.trim(), 0 -> "hi")
    assertEquals(ExternalTool.call(Seq("sh", "-c", "exit 3"), 10.seconds).exitCode, 3)

  test("a tool that hangs: stopped at its timeout - ToolTimeout"):
    val start   = System.nanoTime()
    val timeout = intercept[ToolTimeout](ExternalTool.call(Seq("sleep", "30"), 300.millis))
    assertEquals(timeout.tool, "sleep")
    assert((System.nanoTime() - start).nanos < 10.seconds, "not stopped")

end ExternalToolTest
