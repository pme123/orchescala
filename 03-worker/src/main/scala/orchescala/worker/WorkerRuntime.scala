package orchescala.worker

import zio.{Executor, ZIOAppArgs, ZIOAppDefault, ZLayer, Scope, ZIO, Runtime}

import java.util.concurrent.{Executors, ThreadPoolExecutor, TimeUnit}

object WorkerRuntime:

  // thread pool size for registering workers - hard coded for now (openshift only has one core!)
  def nrOfThreads: Int = 6

  // Create a fixed thread pool executor
  private val threadPool = Executors.newFixedThreadPool(nrOfThreads).asInstanceOf[ThreadPoolExecutor]

  // Create an executor from the thread pool
  private val executor = Executor.fromThreadPoolExecutor(threadPool)

  // Create a layer that provides the executor
  lazy val sharedExecutorLayer = ZLayer.succeed(executor)

  // Register a finalizer with the ZIO runtime to clean up resources
  lazy val threadPoolFinalizer = ZIO
    .addFinalizer :
      ZIO
        .attempt :
          threadPool.shutdown()
          if (!threadPool.awaitTermination(10, TimeUnit.SECONDS)) then
            threadPool.shutdownNow()
        .catchAll: ex =>
          ZIO.logError(s"Error shutting down thread pool.\n$ex")
            .as(threadPool.shutdownNow())
        .zipLeft(ZIO.logInfo("Thread pool has shut down."))
      
    .uninterruptible

  lazy val zioRuntime = zio.Runtime.default
end WorkerRuntime
