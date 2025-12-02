package orchescala
package worker

import orchescala.domain.*
import orchescala.worker.WorkerError.*
import io.circe.syntax.*
import orchescala.engine.rest.SttpClientBackend
import zio.*
import zio.ZIO.*

case class WorkerExecutor[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    T <: Worker[In, Out, ?]
](
    worker: T
)(using context: EngineRunContext):
  given EngineContext = context.engineContext

  def execute(
      processVariables: Seq[IO[BadVariableError, (String, Option[Json])]]
  ): ZIO[SttpClientBackend, WorkerError, Map[String, Any]] =
    (for
      _                            <- logDebug(s"Executing Worker: ${worker.topic}")
      validatedInput               <- InputValidator.validate(processVariables)
      _                            <- logDebug(s"- validatedInput: $validatedInput")
      initializedOutput            <- Initializer.initVariables(validatedInput)
      _                            <- logDebug(s"- initializedOutput: $initializedOutput")
      mockedOutput                 <- OutMocker(worker).mockedOutput(validatedInput)
      _                            <- logDebug(s"- mockedOutput: $mockedOutput")
      // only run the work if it is not mocked
      output                       <-
        if mockedOutput.isEmpty then WorkRunner(worker).run(validatedInput)
        else ZIO.succeed(mockedOutput.get)
      _                            <- logDebug(s"- output: $output")
      allOutputs: Map[String, Any]  = camundaOutputs(validatedInput, initializedOutput, output)
      _                            <- logDebug(s"- allOutputs: $allOutputs")
      filteredOut: Map[String, Any] =
        filteredOutput(allOutputs, context.generalVariables.outputVariableSeq)
      _                            <- logDebug(s"- filteredOut: $filteredOut")
      // make MockedOutput as error if mocked
      _                            <- ZIO.fail(MockedOutput(filteredOut)).when(mockedOutput.isDefined)
    yield filteredOut)

  object InputValidator:
    lazy val prototype         = worker.in
    lazy val validationHandler = worker.validationHandler

    def validate(
        inputParamsAsJson: Seq[IO[OrchescalaError, (String, Option[Json])]]
    ): IO[ValidatorError, In] =

      val jsonResult: IO[ValidatorError, Seq[(String, Option[Json])]] =
        ZIO
          .partition(inputParamsAsJson)(i => i)
          .flatMap:
            case (failures, successes) if failures.isEmpty =>
              ZIO.succeed(successes.toSeq)
            case (failures, _)                             =>
              ZIO.fail(
                ValidatorError(
                  failures
                    .map(_.toString())
                    .mkString("Validator Error(s):\n - ", " - ", "\n")
                )
              )

      val json: IO[ValidatorError, JsonObject] = jsonResult
        .map(_.foldLeft(JsonObject()) { case (jsonObj, jsonKey -> jsonValue) =>
          if jsonValue.isDefined
          then jsonObj.add(jsonKey, jsonValue.get)
          else jsonObj
        })

      def toIn(posJsonObj: IO[ValidatorError, JsonObject]): IO[ValidatorError, In] =
        posJsonObj
          .flatMap(jsonObj =>
            decodeTo[In](jsonObj.asJson.deepDropNullValues.toString)
              .mapError(ex => ValidatorError(errorMsg = ex.errorMsg))
              .flatMap(in =>
                ZIO.fromEither(validationHandler.validate(in))
              )
          )

      val in     = toIn(json)
      val result = in.flatMap:
        case i: WithConfig[?] =>
          val newIn =
            for
              jsonObj: JsonObject   <- json
              inputVariables         = jsonObj.toMap
              configJson: JsonObject =
                inputVariables.getOrElse("inConfig", i.defaultConfigAsJson).asObject.get
              newJsonConfig          = worker.inConfigVariableNames
                                         .foldLeft(configJson):
                                           case (configJson, n) =>
                                             if jsonObj.contains(n)
                                             then configJson.add(n, jsonObj(n).get)
                                             else configJson
            yield jsonObj.add("inConfig", newJsonConfig.asJson)
          toIn(newIn)

        case _ =>
          in
      result
    end validate

  end InputValidator

  object Initializer:
    private val defaultVariables = Map(
      "serviceName" -> "NOT-USED" // serviceName is not needed anymore
    )

    def initVariables(
        validatedInput: In
    )(using EngineContext): IO[InitProcessError, Map[String, Any]] =
      worker.initProcessHandler
        .map: vi =>
          vi.init(validatedInput).map(_ ++ defaultVariables)
        .getOrElse:
          ZIO.succeed(defaultVariables)
  end Initializer

  private def camundaOutputs(
      initializedInput: In,
      internalVariables: Map[String, Any],
      output: Out | NoOutput
  )(using context: EngineRunContext): Map[String, Any] =
    context.toEngineObject(initializedInput) ++ internalVariables ++
      (output match
        case o: NoOutput =>
          context.toEngineObject(o)
        case _           =>
          context.toEngineObject(output.asInstanceOf[Out]))

  private def filteredOutput(
      allOutputs: Map[String, Any],
      outputVariables: Seq[String]
  ): Map[String, Any] =
    if outputVariables.isEmpty then
      allOutputs
    else
      allOutputs
        .filter { case k -> _ => outputVariables.contains(k) }
    end if
  end filteredOutput

end WorkerExecutor
