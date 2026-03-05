package orchescala.engine.w4s

import orchescala.engine.*
import orchescala.engine.domain.EngineError
import zio.ZIO

/** EngineApp trait for W4S engine.
  *
  * Since W4S is an in-process engine, the engine creation is straightforward -
  * no external client connections are needed.
  */
trait W4SEngineApp extends EngineApp:

  def w4sEngineConfig: EngineConfig

  override def engine: ProcessEngine =
    given EngineConfig = w4sEngineConfig
    W4SProcessEngine()

  override def engineZIO: ZIO[Any, EngineError, ProcessEngine] =
    ZIO.attempt:
      engine
    .mapError: ex =>
      EngineError.ProcessError(s"Error creating W4S engine: ${ex.getMessage}")

end W4SEngineApp

