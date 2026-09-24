package orchescala.engine.c8

import orchescala.engine.*
import orchescala.engine.domain.EngineError
import orchescala.engine.services.SignalService
import zio.ZIO.logInfo
import zio.IO

class C8SignalService(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends SignalService with C8EventService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      variables: Option[JsonObject] = None
  ): IO[EngineError, Unit] =
    logInfo(s"Sending Signal '$name'.") *>
      rest
        .postNoContent(
          Seq("signals", "broadcast"),
          Json.obj(
            "signalName" -> name.asJson,
            "variables"  -> variables.fold(Json.obj())(Json.fromJsonObject),
            "tenantId"   -> tenantId.asJson
          )
        )
        .mapError(withContext(s"Problem sending Signal '$name'"))
end C8SignalService
