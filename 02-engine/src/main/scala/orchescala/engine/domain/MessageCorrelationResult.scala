package orchescala.engine.domain

import orchescala.domain.*

enum MessageCorrelationResult:
  def id: String
  def isProcessInstance: Boolean = this match
    case _: MessageCorrelationResult.ProcessInstance => true
    case _                                           => false

  case Execution(
      id: String,
      resultType: MessageCorrelationResult.ResultType =
        MessageCorrelationResult.ResultType.Execution
  )
  case ProcessInstance(
      id: String,
      resultType: MessageCorrelationResult.ResultType =
        MessageCorrelationResult.ResultType.ProcessInstance
  )
end MessageCorrelationResult

object MessageCorrelationResult:
  given ApiSchema[MessageCorrelationResult]  = deriveApiSchema
  given InOutCodec[MessageCorrelationResult] = deriveInOutCodec("resultType")

  enum ResultType:
    case Execution, ProcessInstance
  object ResultType:
    given ApiSchema[ResultType]  = deriveEnumApiSchema
    given InOutCodec[ResultType] = deriveEnumInOutCodec
end MessageCorrelationResult
