package orchescala.engine.domain

trait ProcessResult :
  def processInstanceId: String
  def engineType: EngineType
end ProcessResult
