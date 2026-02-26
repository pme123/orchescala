package orchescala.engine

import zio.logging.backend.SLF4J
import zio.{Executor, ZLayer}

import java.util.concurrent.{Executors, ThreadPoolExecutor, TimeUnit}

object EngineRuntime:

  // thread pool size for registering workers - hard coded for now (openshift only has one core!)
  def nrOfThreads: Int = 6

  // Create a fixed thread pool executor
  private lazy val threadPool: ThreadPoolExecutor =
    val pool = Executors.newFixedThreadPool(nrOfThreads).asInstanceOf[ThreadPoolExecutor]
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

  // Create an executor from the thread pool
  private val executor = Executor.fromThreadPoolExecutor(threadPool)

  lazy val logger = zio.Runtime.removeDefaultLoggers >>> SLF4J.slf4j

  // Create a layer that provides the executor
  lazy val sharedExecutorLayer = ZLayer.succeed(executor)


  lazy val zioRuntime = zio.Runtime.default

end EngineRuntime
