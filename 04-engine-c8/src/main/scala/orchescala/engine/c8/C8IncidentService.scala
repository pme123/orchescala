package orchescala.engine.c8

import io.camunda.zeebe.client.ZeebeClient
import orchescala.engine.*
import orchescala.engine.domain.Incident
import orchescala.engine.inOut.IncidentService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8IncidentService(using
    zeebeClientZIO: IO[EngineError, ZeebeClient],
    engineConfig: EngineConfig
) extends IncidentService:

  def getIncidents(
                    incidentId: Option[String] = None,
                    processInstanceId: Option[String] = None
                  ): IO[EngineError, List[Incident]] = ???

