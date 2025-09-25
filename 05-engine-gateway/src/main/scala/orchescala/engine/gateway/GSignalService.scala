package orchescala.engine.gateway

import orchescala.domain.CamundaVariable
import orchescala.engine.domain.EngineError
import orchescala.engine.services.SignalService
import zio.{IO, ZIO}

class GSignalService(using
    services: Seq[SignalService]
) extends SignalService, GEventService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      variables: Option[Map[String, CamundaVariable]] = None
  ): IO[EngineError, Unit] =
    ZIO
      .foreach(services): service =>
        service.sendSignal(name, tenantId, withoutTenantId, variables)
          .either
      .flatMap: results =>
        val errors = results.collect { case Left(error) => error }
        ZIO
          .fail:
            EngineError.ProcessError(
              s"Signal sending failed: ${errors.map(_.errorMsg).mkString("; ")}"
            )
          .unless(errors.isEmpty)
          .unit
end GSignalService
