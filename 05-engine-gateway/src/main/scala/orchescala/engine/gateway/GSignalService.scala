package orchescala.engine.gateway

import orchescala.domain.CamundaVariable
import orchescala.engine.domain.EngineError
import orchescala.engine.services.SignalService
import zio.{IO, ZIO}

class GSignalService(using
    services: Seq[SignalService]
) extends SignalService, GEventService:

  // a signal is a broadcast - it goes to every engine; it only fails if no engine accepts it
  // (e.g. a C8 that is not reachable must not break a signal for a C7 process)
  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      variables: Option[JsonObject] = None
  ): IO[EngineError, Unit] =
    ZIO
      .foreach(services): service =>
        service.sendSignal(name, tenantId, withoutTenantId, variables)
          .either
          .map(service.engineType -> _)
      .flatMap: results =>
        val failures = results.collect { case (engineType, Left(err)) => engineType -> err }
        if results.isEmpty then
          ZIO.fail(EngineError.ProcessError(s"No services available for sendSignal '$name'"))
        else if failures.size == results.size then
          ZIO.fail(allServicesFailed(s"sendSignal '$name'", failures.map(_._2)))
        else
          ZIO.foreachDiscard(failures): (engineType, err) =>
            ZIO.logWarning(s"sendSignal '$name' failed for $engineType - ignored: ${err.errorMsg}")
end GSignalService
