package orchescala.engine

import zio.ZIO

trait EngineApp:

  // For traditional engines (C7, direct engines)
  def engine: ProcessEngine =
    throw new RuntimeException("Either override 'engine' or 'engineZIO' method")

  // For environment-based engines (C8 with SharedC8ClientManager, C7 with SharedC7ClientManager)
  def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
    ZIO.succeed(engine)
end EngineApp
