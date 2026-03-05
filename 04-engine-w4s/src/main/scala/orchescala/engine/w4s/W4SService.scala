package orchescala.engine.w4s

import orchescala.engine.domain.EngineType
import orchescala.engine.services.EngineService

trait W4SService extends EngineService:
  lazy val engineType: EngineType = EngineType.W4S

