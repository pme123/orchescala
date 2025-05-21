package orchescala.worker

import zio.{Executor, ZIOAppArgs, ZIOAppDefault, ZLayer, Scope, ZIO}

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

  // Add shutdown hook to clean up the thread pool when the JVM exits
  Runtime.getRuntime.addShutdownHook(new Thread(() => {
    threadPool.shutdown()
    if (!threadPool.awaitTermination(10, TimeUnit.SECONDS)) {
      threadPool.shutdownNow()
    }
    println("Thread pool has shut down.")
  }))

  lazy val zioRuntime = zio.Runtime.default
end WorkerRuntime
