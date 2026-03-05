package orchescala.worker.w4s

import orchescala.engine.SharedClientManager
import zio.{ZIO, *}

/** Manages the shared W4S engine instance.
  *
  * Since W4S is an in-process engine (not an external BPMN engine),
  * this manager handles the lifecycle of the W4S workflow engine.
  * The engine is created once and shared across all W4S workers.
  */
type SharedW4SEngineManager = SharedClientManager[W4SEngineRuntime, Throwable]

/** Represents the W4S engine runtime that manages workflow execution.
  * This is a lightweight wrapper that will be extended when the
  * W4S engine module provides the actual engine implementation.
  */
trait W4SEngineRuntime:
  def isRunning: Boolean
  def shutdown(): Unit

object SharedW4SEngineManager:

  /** ZLayer that provides SharedW4SEngineManager service */
  lazy val layer: ZLayer[Any, Nothing, SharedW4SEngineManager] =
    SharedClientManager.createLayer[W4SEngineRuntime, Throwable](
      "W4S Engine",
      engine =>
        ZIO
          .attempt(engine.shutdown())
          .tapBoth(
            err => ZIO.logError(s"Error closing shared W4S engine: $err"),
            _ => ZIO.logInfo("Shared W4S engine closed successfully")
          ).ignore
    )

  /** Convenience method to access the service */
  def getOrCreateEngine(engineFactory: ZIO[Any, Throwable, W4SEngineRuntime])
      : ZIO[SharedW4SEngineManager, Throwable, W4SEngineRuntime] =
    SharedClientManager.getOrCreateClient(engineFactory)

end SharedW4SEngineManager

