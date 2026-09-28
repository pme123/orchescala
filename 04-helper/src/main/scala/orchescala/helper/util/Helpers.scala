package orchescala.helper.util

import orchescala.api.ApiConfig

trait Helpers:

  protected implicit lazy val workDir: os.Path =
    val wd = os.pwd
    println(s"Working Directory: $wd")
    wd
  end workDir

  protected def check(label: String, port: Int): Unit =
    Helpers.waitUntilReady(label):
      scala.util.Try(
        os.proc(
          "curl",
          "--head",
          "--silent",
          "--output",
          "/dev/null",
          s"http://localhost:$port"
        ).callOnConsole()
      ).isSuccess
    println(s"Check http://localhost:$port")
  end check

  extension (proc: os.proc)

    def callOnConsole(path: os.Path = os.pwd): Unit =
      println(proc.command.flatMap(_._1).mkString(" "))
      val result = proc.call(cwd = path, stdout = os.Inherit)
      println(result.out.text())
  end extension
end Helpers

object Helpers:

  /** Waits until `ready` - at most `maxWait`: a container that never came up (a port in use, a
    * wrong image) was waited for without end.
    */
  def waitUntilReady(
      label: String,
      maxWait: scala.concurrent.duration.FiniteDuration = scala.concurrent.duration.Duration(5, "minutes"),
      pause: scala.concurrent.duration.FiniteDuration = scala.concurrent.duration.Duration(1, "second")
  )(ready: => Boolean): Unit =
    val deadline = maxWait.fromNow
    while !ready do
      if deadline.isOverdue() then
        throw IllegalStateException(s"$label is not ready after $maxWait - see the Docker logs")
      println(s"waiting for $label ...")
      Thread.sleep(pause.toMillis)
    println(s"$label is ready to use!")
  end waitUntilReady

end Helpers
