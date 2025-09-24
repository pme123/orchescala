package orchescala.engine

import orchescala.domain.*

case class EngineConfig(
    tenantId: Option[String] = None
)

enum EngineType:
  case C7, C8
object EngineType:
  given InOutCodec[EngineType] = deriveEnumInOutCodec
  given ApiSchema[EngineType]  = deriveApiSchema
end EngineType