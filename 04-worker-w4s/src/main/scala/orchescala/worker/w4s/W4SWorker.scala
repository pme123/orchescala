package orchescala.worker.w4s

import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import zio.*
import zio.ZIO.*

import java.util.Date

/** W4S Worker trait for workflows4s-based workers.
  *
  * Unlike C7/C8/Op workers that connect to an external BPMN engine,
  * W4S workers run in-process. The W4S engine calls workers directly
  * through their `runWorker` method.
  */
trait W4SWorker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends WorkerDsl[In, Out], BaseWorker[In, Out]:

  protected def w4sContext: W4SContext

  def logger: OrchescalaLogger = w4sContext.getLogger(getClass)

  /** Execute the worker with the given input variables.
    * This is called by the W4S engine when a workflow step is reached.
    */
  def runWorker(
      inputVariables: Map[String, Any],
      generalVariables: GeneralVariables
  ): ZIO[SttpClientBackend, WorkerError, Map[String, Any]] =
    for
      startDate <- succeed(new Date())
      _         <- logInfo(s"W4S Worker: ${worker.topic} started")
      result    <- executeWorker(inputVariables, generalVariables)
      _         <- logInfo(
                     s"W4S Worker: ${worker.topic} ended ${printTimeOnConsole(startDate)}"
                   )
    yield result

  private def executeWorker(
      inputVariables: Map[String, Any],
      generalVariables: GeneralVariables
  ): ZIO[SttpClientBackend, WorkerError, Map[String, Any]] =
    val processVariables =
      worker.variableNames.map: key =>
        succeed(key -> inputVariables.get(key).flatMap(v => Option(v).map(anyToJson)))
    for
      given EngineRunContext <- createEngineRunContext(generalVariables)
      executor               <- createExecutor
      filteredOut            <- executor.execute(processVariables)
      _                      <- logDebug(s"W4S Worker filteredOut: $filteredOut")
    yield filteredOut

  private def createEngineRunContext(generalVariables: GeneralVariables) =
    attempt(EngineRunContext(w4sContext, generalVariables)).mapError(ex =>
      UnexpectedError(
        s"Problem creating EngineRunContext: ${ex.getMessage}"
      )
    )

  private def createExecutor(using EngineRunContext) =
    attempt(WorkerExecutor(worker)).mapError(ex =>
      UnexpectedError(
        s"Problem creating WorkerExecutor: ${ex.getMessage}"
      )
    )

  private def anyToJson(value: Any): Json =
    value match
      case j: Json   => j
      case s: String => Json.fromString(s)
      case i: Int    => Json.fromInt(i)
      case l: Long   => Json.fromLong(l)
      case d: Double => Json.fromDoubleOrNull(d)
      case b: Boolean => Json.fromBoolean(b)
      case null       => Json.Null
      case other      => Json.fromString(other.toString)

end W4SWorker

