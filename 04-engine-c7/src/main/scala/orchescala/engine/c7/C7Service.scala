package orchescala.engine.c7

import orchescala.engine.domain.EngineType
import orchescala.engine.services.EngineService

trait C7Service extends EngineService:
  lazy val engineType: EngineType = EngineType.C7
