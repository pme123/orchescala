package orchescala.worker.c7

import orchescala.worker.c7.CamundaHelper.*
import orchescala.domain.*
import orchescala.worker.*
import orchescala.worker.WorkerError.BadVariableError
import org.camunda.bpm.engine.variable.`type`.ValueType
import org.camunda.bpm.engine.variable.value.TypedValue
import zio.{IO, ZIO}

/** Validator to validate the input variables automatically.
 */
object ProcessVariablesExtractor:

  type VariableType = HelperContext[Seq[IO[BadVariableError, (String, Option[Json])]]]
  type GeneralVariableType = HelperContext[IO[BadVariableError, GeneralVariables]]

  // gets the input variables of the process as Optional Jsons.
  def extract(variableNames: Seq[String]): VariableType =
    variableNames
      .map(k => k -> variableTypedOpt(k))
      .map {
        case k -> Some(typedValue) if typedValue.getType == ValueType.NULL =>
          ZIO.succeed(k -> None) // k -> null as Camunda Expressions need them
        case k -> Some(typedValue) =>
          extractValue(typedValue)
            .map(v => k -> Some(v))
            .mapError(ex => BadVariableError(s"Problem extracting Process Variable $k: ${ex.errorMsg}"))
        case k -> None =>
          ZIO.succeed(k -> None) // k -> null as Camunda Expressions need them
      }
  end extract

  def extractGeneral(generalVariablesFromError: Option[GeneralVariables] = None): GeneralVariableType =
    generalVariablesFromError
      .map(ZIO.succeed(_))
      .getOrElse:
        for
          // mocking
          servicesMocked <- variableOpt[Boolean](InputParams._servicesMocked)
          mockedWorkers <- extractSeqFromArrayOrStringOpt(InputParams._mockedWorkers)
          outputMockOpt <- jsonVariableOpt(InputParams._outputMock)
          outputServiceMockOpt <- jsonVariableOpt(InputParams._outputServiceMock)
          // mapping
          manualOutMapping <- variableOpt[Boolean](InputParams._manualOutMapping)
          outputVariables <- extractSeqFromArrayOrStringOpt(InputParams._outputVariables)
          handledErrors <- extractSeqFromArrayOrStringOpt(InputParams._handledErrors)
          regexHandledErrors <- extractSeqFromArrayOrStringOpt(InputParams._regexHandledErrors)
          // authorization
          identityCorrelationOpt <- variableOpt[IdentityCorrelation](InputParams._identityCorrelation)
          // DEPRECATED
          servicesMockedOld <- variableOpt[Boolean](InputParams.servicesMocked)
          mockedWorkersOld <- extractSeqFromArrayOrStringOpt(InputParams.mockedWorkers)
          outputMockOptOld <- jsonVariableOpt(InputParams.outputMock)
          outputServiceMockOptOld <- jsonVariableOpt(InputParams.outputServiceMock)
          manualOutMappingOld <- variableOpt[Boolean](InputParams.manualOutMapping)
          outputVariablesOld <- extractSeqFromArrayOrStringOpt(InputParams.outputVariables)
          handledErrorsOld <- extractSeqFromArrayOrStringOpt(InputParams.handledErrors)
          regexHandledErrorsOld <- extractSeqFromArrayOrStringOpt(InputParams.regexHandledErrors)
          impersonateUserIdOpt <- variableOpt[String](InputParams.impersonateUserId)
        yield GeneralVariables(
          _servicesMocked = servicesMocked.orElse(servicesMockedOld),
          _mockedWorkers = mockedWorkers.orElse(mockedWorkersOld),
          _outputMock = outputMockOpt.orElse(outputMockOptOld),
          _outputServiceMock = outputServiceMockOpt.orElse(outputServiceMockOptOld),
          _outputVariables = outputVariables.orElse(outputVariablesOld),
          _manualOutMapping = manualOutMapping.orElse(manualOutMappingOld),
          _handledErrors = handledErrors.orElse(handledErrorsOld),
          _regexHandledErrors = regexHandledErrors.orElse(regexHandledErrorsOld),
          _identityCorrelation = identityCorrelationOpt,
          impersonateUserId = impersonateUserIdOpt
        )
  end extractGeneral

end ProcessVariablesExtractor
