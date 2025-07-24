package orchescala.engine.c8

import orchescala.domain.*
import orchescala.engine.EngineError.MappingError
import zio.{IO, ZIO}

object C8VariableMapper:
  
  def toC8Variables(in: Json): IO[MappingError, Map[String, Any]] =
    ???
          
  
