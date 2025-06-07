package orchescala.simulation2

enum SimulationError extends RuntimeException:

  case MatchingError(scenarioData: ScenarioData)