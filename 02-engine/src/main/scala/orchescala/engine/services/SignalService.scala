package orchescala.engine.services

import orchescala.domain.*
import orchescala.engine.domain.*
import zio.IO

trait SignalService extends EngineService:

  def sendSignal(
      @description("The name of the signal to deliver.")
      name: String,
      @description(
        """
          |Specifies a tenant to deliver the signal. The signal can only be received on executions or process definitions which belongs to the given tenant.
          |
          |Note: Cannot be used in combination with executionId.
          |""".stripMargin
      )
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      @description(
        """A JSON object containing variable key-value pairs. Each key is a variable name and each value a JSON variable value object."""
      )
      variables: Option[JsonObject] = None
  ): IO[EngineError, Unit]
end SignalService
