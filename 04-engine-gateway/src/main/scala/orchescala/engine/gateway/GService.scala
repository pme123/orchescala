package orchescala.engine.gateway

import orchescala.engine.domain.EngineType
import orchescala.engine.services.EngineService

trait GService extends EngineService:
  lazy val engineType: EngineType = EngineType.Gateway
