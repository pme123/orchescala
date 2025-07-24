package orchescala.engine.c8

import io.camunda.zeebe.client.ZeebeClient
import orchescala.domain.CamundaVariable
import orchescala.engine.*
import orchescala.engine.inOut.SignalService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8SignalService(using
    zeebeClientZIO: IO[EngineError, ZeebeClient],
    engineConfig: EngineConfig
) extends SignalService with C8EventService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      executionId: Option[String] = None,
      variables: Option[Map[String, CamundaVariable]] = None
  ): IO[EngineError, Unit] =
    for
      zeebeClient <- zeebeClientZIO
      _           <- logInfo(s"Sending Signal '$name'.")
      variablesMap = mapToC8Variables(variables)
      _           <-
        ZIO
          .attempt {
            // Note: Zeebe handles signals differently than Camunda 7
            // This is a simplified implementation
            zeebeClient
              .newPublishMessageCommand()
              .messageName(s"signal-$name")
              .correlationKey("signal-correlation")
              .variables(variablesMap)
              .send()
              .join()
          }
          .mapError { err =>
            EngineError.ProcessError(
              s"Problem sending Signal '$name': ${err.getMessage}"
            )
          }
    yield ()