package orchescala.engine.w4s

import orchescala.engine.SharedClientManager
import orchescala.engine.domain.EngineError
import zio.*

/** W4S Runtime handle - represents the in-process W4S engine runtime.
  * Since W4S runs in-process, this is a lightweight wrapper.
  */
trait W4SRuntime:
  def isRunning: Boolean

object W4SRuntime:
  def apply(): W4SRuntime = new W4SRuntime:
    def isRunning: Boolean = true

/** Service trait for managing shared W4S runtime */
type SharedW4SClientManager = SharedClientManager[W4SRuntime, EngineError]

object SharedW4SClientManager:

  /** ZLayer that provides SharedW4SClientManager service */
  lazy val layer: ZLayer[Any, Nothing, SharedW4SClientManager] =
    SharedClientManager.createLayer[W4SRuntime, EngineError](
      "W4S Runtime",
      runtime =>
        ZIO.unit // W4S runtime is in-process, no external cleanup needed
    )

  /** Convenience method to access the service */
  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, W4SRuntime])
      : ZIO[SharedW4SClientManager, EngineError, W4SRuntime] =
    SharedClientManager.getOrCreateClient(clientFactory)

end SharedW4SClientManager

