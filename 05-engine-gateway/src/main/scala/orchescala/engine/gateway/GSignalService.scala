package orchescala.engine.gateway

import orchescala.domain.CamundaVariable
import orchescala.engine.domain.EngineError
import orchescala.engine.services.SignalService
import zio.IO

class GSignalService(using
    services: Seq[SignalService]
) extends SignalService, GEventService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      variables: Option[Map[String, CamundaVariable]] = None
  ): IO[EngineError, Unit] = //TODO special send it to all engines
    tryServicesWithErrorCollection[SignalService, Unit](
      _.sendSignal(name, tenantId, withoutTenantId, variables),
      "sendSignal",
    )
end GSignalService
