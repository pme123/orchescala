package orchescala.helper.util

import munit.FunSuite

/** A release stops at a failing step - that rests on `callOnConsole` throwing on a non-zero
  * exit of sbt.
  */
class CallOnConsoleTest extends FunSuite, Helpers:

  test("a process that fails throws - a release stops there"):
    intercept[os.SubprocessException](os.proc("false").callOnConsole())

  test("a process that succeeds does not"):
    os.proc("true").callOnConsole()

end CallOnConsoleTest
