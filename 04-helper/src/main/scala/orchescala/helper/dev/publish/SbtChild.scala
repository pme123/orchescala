package orchescala.helper.dev.publish

/** The sbt child of a release - run on the console; a shutdown hook waits for it to end
  * before it restores the working tree (the child got the Ctrl-C too and may still write).
  */
object SbtChild:
  // every access under the lock: spawned and registered together (one at a time, a hook never
  // misses a child just spawned); a child gone from here has exited (`waitFor` returned), its
  // output went to the console directly. The child is the sbt JVM itself - the `sbt` script
  // execs it - and what it started (docker) are its descendants; a descendant that outlives
  // its parent is not found any more (said by `terminate`).
  private var running: Option[os.SubProcess] = None

  /** One at a time - a release runs its sbt steps one after the other. */
  def run(cmd: Seq[String]): Unit =
    println(cmd.mkString(" "))
    val child = synchronized:
      if running.nonEmpty then
        throw IllegalStateException(s"An sbt run is going on already - `${cmd.mkString(" ")}` can not start.")
      val c = os.proc(cmd).spawn(stdout = os.Inherit, stderr = os.Inherit)
      running = Some(c)
      c
    try
      child.waitFor()
      if child.exitCode() != 0 then
        throw IllegalStateException(s"`${cmd.mkString(" ")}` failed with exit code ${child.exitCode()}")
    catch
      // the thread was interrupted (a caller in a thread of its own) - the child must not go
      // on writing while the tree is restored
      case e: InterruptedException =>
        terminate(child, s"`${cmd.mkString(" ")}` (interrupted)")
        throw e
    finally synchronized { running = None }
  end run

  /** Waits for the running child - at most `timeout`; then it is ended: on Ctrl-C it got
    * the signal too and ends on its own, but it must not go on writing while the tree is
    * restored.
    */
  def awaitExit(timeout: scala.concurrent.duration.FiniteDuration = scala.concurrent.duration.Duration(10, "seconds")): Unit =
    synchronized(running).foreach: child =>
      println("Waiting for sbt to end ...")
      if !child.waitFor(timeout.toMillis) then terminate(child, s"sbt (not ended within $timeout)")

  /** Ends the child (the sbt launcher) and what it started (the sbt JVM, docker) - forcibly
    * after 3 seconds; about 10 seconds at most, on top of the wait of [[awaitExit]] (so about
    * 20 seconds in all before the restore of a shutdown hook - it must still come before a
    * second Ctrl-C).
    */
  private def terminate(child: os.SubProcess, what: String): Unit =
    import scala.jdk.CollectionConverters.*
    val handle  = child.wrapped.toHandle
    // the snapshot stays valid once the child is gone and they are reparented - one started
    // in between is missed, and one that ignores the signals may go on (said below)
    val started = handle.descendants().toList.asScala.toSeq
    println(s"Ending $what - pid ${handle.pid} and the ${started.size} processes it started")
    child.destroy()
    started.foreach(_.destroy())
    if !child.waitFor(3000) then
      child.destroyForcibly()
      child.waitFor(3000)
    started.filter(_.isAlive).foreach(_.destroyForcibly())
    // a killed process takes a moment to go - up to 3 seconds
    val deadline = System.currentTimeMillis() + 3000
    while (child.isAlive() || started.exists(_.isAlive)) && System.currentTimeMillis() < deadline do
      Thread.sleep(100)
    val stillAlive = Option.when(child.isAlive())(handle.pid).toSeq ++ started.filter(_.isAlive).map(_.pid)
    if stillAlive.nonEmpty then
      println(
        s"WARNING: $what did not end (pids ${stillAlive.mkString(", ")}) - it may still write " +
          "while the working tree is restored."
      )
    else println(s"$what ended.")
  end terminate
end SbtChild
