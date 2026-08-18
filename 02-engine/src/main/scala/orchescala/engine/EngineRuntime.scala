package orchescala.engine

import zio.logging.backend.SLF4J
import zio.{Executor, ZLayer}

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.{Executors, ThreadPoolExecutor, TimeUnit}

object EngineRuntime:

  // thread pool size for registering workers - hard coded for now (openshift only has one core!)
  def nrOfThreads: Int = 6

  private val threadCounter = new AtomicInteger(0)

  // Create a fixed thread pool executor
  private lazy val threadPool: ThreadPoolExecutor =
    // daemon threads: this global pool must never keep a JVM (e.g. a test runner) alive -
    // the application itself is kept alive by the blocking main thread, not by this pool
    val pool = Executors.newFixedThreadPool(
      nrOfThreads,
      { (r: Runnable) =>
        val t = new Thread(r, s"orchescala-engine-${threadCounter.getAndIncrement()}")
        t.setDaemon(true)
        t
      }
    ).asInstanceOf[ThreadPoolExecutor]
    // Register a JVM shutdown hook to clean up the thread pool on JVM exit.
    // This avoids the problem of closing the globally cached pool at the end of
    // each ZIO scope, which would break later simulations in the same JVM.
    java.lang.Runtime.getRuntime.addShutdownHook(new Thread(() =>
      pool.shutdown()
      if !pool.awaitTermination(10, TimeUnit.SECONDS) then
        pool.shutdownNow()
        ()
    ))
    pool

  // Create an executor from the thread pool (lazy: don't spin up threads for JVMs
  // that only touch other members of this object, e.g. tests using zioRuntime)
  private lazy val executor = Executor.fromThreadPoolExecutor(threadPool)

  lazy val logger = zio.Runtime.removeDefaultLoggers >>> SLF4J.slf4j

  // Create a layer that provides the executor
  lazy val sharedExecutorLayer = ZLayer.succeed(executor)


  lazy val zioRuntime = zio.Runtime.default

end EngineRuntime
