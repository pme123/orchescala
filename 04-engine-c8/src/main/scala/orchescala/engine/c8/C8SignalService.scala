package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.domain.CamundaVariable
import orchescala.engine.*
import orchescala.engine.domain.EngineError
import orchescala.engine.services.SignalService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8SignalService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends SignalService with C8EventService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      variables: Option[JsonObject] = None
  ): IO[EngineError, Unit] =
    for
      camundaClient <- camundaClientZIO
      _           <- logInfo(s"Sending Signal '$name'.")
      variablesMap = variables.map(_.toVariablesMap).getOrElse(Map.empty)
      _           <-
        ZIO
          .fromFutureJava :
            camundaClient
              .newBroadcastSignalCommand()
              .signalName(name)
              .variables(variablesMap)
              .send()
          .mapError { err =>
            EngineError.ProcessError(
              s"Problem sending Signal '$name': $err"
            )
          }
    yield ()