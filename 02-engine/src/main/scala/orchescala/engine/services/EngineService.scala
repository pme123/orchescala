package orchescala.engine.services

import orchescala.engine.domain.EngineType

trait EngineService :
  def engineType: EngineType
