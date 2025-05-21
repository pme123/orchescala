package orchescala.worker

import zio.{Executor, ZIOAppArgs, ZIOAppDefault, ZLayer, Scope, ZIO}

import java.util.concurrent.{Executors, ThreadPoolExecutor, TimeUnit}

object WorkerRuntime:

  // thread pool size for registering workers - hard coded for now (openshift only has one core!)
  def nrOfThreads: Int = 6

  // Create the thread pool and executor as a managed resource
  lazy val managedExecutor =
    ZIO.acquireRelease {
      ZIO.succeed:
        val pool = Executors.newFixedThreadPool(nrOfThreads).asInstanceOf[ThreadPoolExecutor]
        val exec = Executor.fromThreadPoolExecutor(pool)
        (pool, exec)
    } { case (pool, _) =>
      ZIO
        .attempt:
          pool.shutdown()
          if !pool.awaitTermination(10, TimeUnit.SECONDS)
          then
            pool.shutdownNow()
        .zipLeft(ZIO.logInfo("Thread pool has shut down."))
        .catchAll: ex =>
          ZIO.logError(s"Error shutting down thread pool.\n$ex")
            .as(pool.shutdownNow())

    }

  // Create layers from the managed executor
  // Use this shared executor for all workers
  lazy val sharedExecutorLayer = ZLayer.scoped {
    managedExecutor.map { case (_, exec) => exec }
  }

  lazy val loggerLayer = ZioLogger.logger

  lazy val zioRuntime = zio.Runtime.default
end WorkerRuntime
