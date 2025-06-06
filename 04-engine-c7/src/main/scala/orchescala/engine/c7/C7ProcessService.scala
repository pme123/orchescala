package orchescala.engine
package c7

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.*
import org.camunda.community.rest.client.api.ProcessDefinitionApi
import org.camunda.community.rest.client.dto.StartProcessInstanceDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C7ProcessService(apiClient: ApiClient) extends ProcessService:

  private lazy val processDefinitionApi = new ProcessDefinitionApi(apiClient)

  override def startProcessAsync[In <: Product: InOutEncoder](
      processDefId: String,
      in: In,
      businessKey: Option[String] = None
  ): IO[EngineError, EngineProcessInfo] =
    val processVariables = InOutC7VariableMapper.toC7Variables(in).asJava
    for
      instance <- ZIO
                    .attempt:
                      processDefinitionApi
                        .startProcessInstanceByKey(
                          processDefId,
                          new StartProcessInstanceDto()
                            .variables(processVariables)
                            .businessKey(businessKey.orNull)
                        )
                    .mapError: err =>
                      EngineError.ProcessError(
                        s"Problem starting Process '$processDefId': ${err.getMessage}"
                      )
    yield EngineProcessInfo(
      processInstanceId = instance.getId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessStatus.Active
    )
  end startProcessAsync

  def startProcess[In <: Product: InOutEncoder, Out <: Product: InOutDecoder](
      processDefId: String,
      in: In,
      businessKey: Option[String]
  ): IO[EngineError, Out] = ???

  def sendMessage[In <: Product: InOutEncoder](
      messageDefId: String,
      in: In
  ): IO[EngineError, EngineProcessInfo] = ???

  def sendSignal[In <: Product: InOutEncoder](
      signalDefId: String,
      in: In
  ): IO[EngineError, EngineProcessInfo] = ???
end C7ProcessService
