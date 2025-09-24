package orchescala.engine.c8

import orchescala.engine.domain.EngineType
import orchescala.engine.services.EngineService

trait C8Service extends EngineService:
  lazy val engineType: EngineType = EngineType.C8
