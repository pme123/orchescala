package orchescala.engine
package c7

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.domain.ProcessInfo
import orchescala.engine.{ProcessEngine, *}
import orchescala.engine.inOut.ProcessInstanceService
import orchescala.engine.json.JProcessInstanceService
import zio.{IO, ZIO}

class C7ProcessInstanceService(jProcessService: JProcessInstanceService) extends ProcessInstanceService:
  
  def startProcessAsync[In <: Product: InOutEncoder](
      processDefId: String,
      in: In,
      businessKey: Option[String] = None
  ): IO[EngineError, ProcessInfo] =
    jProcessService.startProcessAsync(processDefId, in.asJson, businessKey)
  end startProcessAsync

  def getVariables[In <: Product : InOutDecoder](
                                                  processInstanceId: String,
                                                  inOut: In
                                                ): IO[EngineError, In] =
    for
      variables <- jProcessService.getVariables(processInstanceId, inOut)
      json <- 
        ZIO
          .foldLeft(variables)(JsonObject.empty):
            case (jsonObj, jsonProp) =>
              ZIO.succeed(jsonObj.add(jsonProp.key, jsonProp.value))
          
      in <- ZIO.fromEither(json.toJson.as[In])
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem decoding variables for $processInstanceId ($variables): ${err.getMessage}"
            )
    yield in        

end C7ProcessInstanceService
