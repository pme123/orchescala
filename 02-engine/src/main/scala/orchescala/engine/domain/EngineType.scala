package orchescala.engine.domain

import orchescala.domain.*

enum EngineType:
  case C7, C8, Gateway
object EngineType:
  given InOutCodec[EngineType] = deriveEnumInOutCodec
  given ApiSchema[EngineType]  = deriveEnumApiSchema
end EngineType
