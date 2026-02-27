package orchescala.engine.op

import orchescala.engine.c7.C7Service
import orchescala.engine.domain.EngineType

trait OperatonService extends C7Service:
  override lazy val engineType: EngineType = EngineType.Op

