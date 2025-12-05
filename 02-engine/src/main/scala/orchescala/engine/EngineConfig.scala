package orchescala.engine

import orchescala.domain.*

case class EngineConfig(
    tenantId: Option[String] = None,
    @description("The key of the process variable that contains an additional value to verify the impersonate User")
    impersonateProcessKey: Option[String] = None
)
