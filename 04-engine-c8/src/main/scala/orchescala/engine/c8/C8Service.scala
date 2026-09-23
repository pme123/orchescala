package orchescala.engine.c8

import orchescala.engine.domain.EngineType
import orchescala.engine.services.EngineService

trait C8Service extends EngineService:
  lazy val engineType: EngineType = EngineType.C8

object C8Service:
  /** Page size for variable searches. The Camunda client defaults to 100 items without an
    * explicit page - a process instance with many task/call-activity scopes exceeds that easily.
    */
  val variablesPageLimit: Int = 1000
