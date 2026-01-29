package orchescala.domain

// ApiCreator that describes these variables
case class GeneralVariables(
    // mocking
    _servicesMocked: Option[Boolean] = None,         // Process only
    _mockedWorkers: Option[StringOrSeq] = None,      // Process only
    _outputMock: Option[Json] = None,
    _outputServiceMock: Option[Json] = None,         // Service only
    // mapping
    _manualOutMapping: Option[Boolean] = None,       // Service only
    _outputVariables: Option[StringOrSeq] = None,    // Service only
    _handledErrors: Option[StringOrSeq] = None,      // Service only
    _regexHandledErrors: Option[StringOrSeq] = None, // Service only
    // authorization
    _identityCorrelation: Option[IdentityCorrelation] = None,
    // DEPRECATED
    @deprecated("Use `identityCorrelation`")
    impersonateUserId: Option[String] = None,
    @deprecated("Use `_servicesMocked`")
    servicesMocked: Option[Boolean] = None,          // Process only
    @deprecated("Use `_mockedWorkers`")
    mockedWorkers: Option[StringOrSeq] = None,       // Process only
    @deprecated("Use `_outputMock`")
    outputMock: Option[Json] = None,
    @deprecated("Use `_outputServiceMock`")
    outputServiceMock: Option[Json] = None,          // Service only
    @deprecated("Use `_manualOutMapping`")
    manualOutMapping: Option[Boolean] = None,        // Service only
    @deprecated("Use `_outputVariables`")
    outputVariables: Option[StringOrSeq] = None,     // Service only
    @deprecated("Use `_handledErrors`")
    handledErrors: Option[StringOrSeq] = None,       // Service only
    @deprecated("Use `_regexHandledErrors`")
    regexHandledErrors: Option[StringOrSeq] = None   // Service only
):

  lazy val mockedWorkerSeq: Seq[String]      = asSeq(_mockedWorkers.orElse(mockedWorkers))
  lazy val outputVariableSeq: Seq[String]    = asSeq(_outputVariables.orElse(outputVariables))
  lazy val handledErrorSeq: Seq[String]      = asSeq(_handledErrors.orElse(handledErrors))
  lazy val regexHandledErrorSeq: Seq[String] = asSeq(_regexHandledErrors.orElse(regexHandledErrors))

  def isMockedService: Boolean                         = _servicesMocked.orElse(servicesMocked).contains(true)
  def isManualOutMapping: Boolean                      = _manualOutMapping.orElse(manualOutMapping).contains(true)
  def isMockedWorker(workerTopicName: String): Boolean =
    mockedWorkerSeq.contains(workerTopicName)

  private def asSeq(value: Option[StringOrSeq]): Seq[String] =
    value match
      case None | Some("")        => Seq.empty
      case Some(s: String)        => s.split(",").toSeq
      case Some(seq: Seq[String]) => seq
end GeneralVariables

object GeneralVariables:
  given InOutCodec[GeneralVariables] = deriveInOutCodec
  given ApiSchema[GeneralVariables]  = deriveApiSchema

  lazy val variableNames: Seq[String] = allFieldNames[GeneralVariables]

end GeneralVariables
