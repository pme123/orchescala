package orchescala.engine

import orchescala.engine.domain.EngineError
import zio.ZIO

trait EngineApp:

  // For traditional engines (C7, direct engines)
  def engine: ProcessEngine =
    throw new RuntimeException("Either override 'engine' or 'engineZIO' method")

  // For environment-based engines (C8 with SharedC8ClientManager, C7 with SharedC7ClientManager)
  def engineZIO: ZIO[Any, EngineError, ProcessEngine] =
    ZIO.scoped:
      for
        _      <- EngineRuntime.threadPoolFinalizer
        engine <- ZIO.attempt(engine)
                    .mapError(ex =>
                      EngineError.ProcessError(s"Error creating engine: ${ex.getMessage}")
                    )
      yield engine

end EngineApp
