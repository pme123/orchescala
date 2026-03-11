package orchescala.worker.w4s

import zio.ZIO

/** W4S Worker Client trait - analogous to C7WorkerClient/OpWorkerClient.
  *
  * Since W4S is an in-process engine (not an external BPMN engine),
  * the "client" is simpler: it provides access to the shared W4S engine runtime
  * rather than connecting to an external REST API.
  */
trait W4SWorkerClient:
  /** Get or create the shared W4S engine runtime.
    * Uses SharedW4SEngineManager for lifecycle management.
    */
  def engine: ZIO[SharedW4SEngineManager, Throwable, W4SEngineRuntime]

  /** Whether the engine uses persistent storage (default: in-memory) */
  protected def persistent: Boolean = false

  /** Optional storage path for persistent mode */
  protected def storagePath: Option[String] = None
end W4SWorkerClient

/** Default W4S Worker Client using an in-memory engine.
  * This is the simplest configuration, suitable for development and testing.
  */
trait W4SInMemoryWorkerClient extends W4SWorkerClient:

  override protected def persistent: Boolean = false

  lazy val engine: ZIO[SharedW4SEngineManager, Throwable, W4SEngineRuntime] =
    SharedW4SEngineManager.getOrCreateEngine:
      ZIO.logInfo("Creating W4S Engine Runtime (In-Memory)") *>
        ZIO
          .attempt(W4SEngineRuntime.create())
          .tap(_ => ZIO.logInfo("W4S Engine Runtime (In-Memory) created successfully"))
          .tapError(err => ZIO.logError(s"Failed to create W4S Engine Runtime (In-Memory): $err"))

end W4SInMemoryWorkerClient

/** W4S Worker Client with persistent storage.
  * Uses a configurable storage path for durable workflow state.
  */
class W4SPersistentWorkerClient(
    override protected val storagePath: Option[String] = Some("w4s-data")
) extends W4SWorkerClient:

  override protected def persistent: Boolean = true

  lazy val engine: ZIO[SharedW4SEngineManager, Throwable, W4SEngineRuntime] =
    SharedW4SEngineManager.getOrCreateEngine:
      ZIO.logInfo(
        s"Creating W4S Engine Runtime (Persistent, path: ${storagePath.getOrElse("default")})"
      ) *>
        ZIO
          .attempt(W4SEngineRuntime.create())
          .tap(_ => ZIO.logInfo("W4S Engine Runtime (Persistent) created successfully"))
          .tapError(err => ZIO.logError(s"Failed to create W4S Engine Runtime (Persistent): $err"))

end W4SPersistentWorkerClient

