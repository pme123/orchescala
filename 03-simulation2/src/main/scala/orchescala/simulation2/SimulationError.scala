package orchescala.simulation2

enum SimulationError extends RuntimeException:
  def msg: String =
    scenarioData.maxLevelMsg
  def scenarioData: ScenarioData
  
  override def getMessage: String =
    s"${this.getClass.getSimpleName}: $msg"

  case ProcessError(scenarioData: ScenarioData)
  case MappingError(scenarioData: ScenarioData)
  case WaitingError(scenarioData: ScenarioData)
end SimulationError
