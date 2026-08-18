package orchescala.simulation

enum SimulationError extends RuntimeException:
  def msg: String =
    scenarioData.maxLevelMsg
  def scenarioData: ScenarioData
  
  override def getMessage: String =
    s"${this.getClass.getSimpleName}: $msg"

  case ProcessError(scenarioData: ScenarioData)
  case MappingError(scenarioData: ScenarioData)
  case WaitingError(scenarioData: ScenarioData)
  case EngineError(override val msg: String, scenarioData: ScenarioData = ScenarioData("UnexpectedError"))
end SimulationError
