package orchescala.engine.gateway

import orchescala.engine.EngineError
import orchescala.engine.services.ProcessInstanceService
import zio.{IO, ZIO}

private[gateway] def tryServicesWithErrorCollection[S, A](
                                               operation: S => IO[EngineError, A],
                                               operationName: String
                                             )(using services: Seq[S]): IO[EngineError, A] =
  services match
    case Nil => ZIO.fail(EngineError.ProcessError("No services available"))
    case _ =>
      services.foldLeft(ZIO.succeed((List.empty[EngineError], Option.empty[A]))): (acc, service) =>
        acc.flatMap:
          case (errors, Some(result)) => ZIO.succeed((errors, Some(result)))
          case (errors, None) =>
            operation(service)
              .fold(
                error => (errors :+ error, None),
                result => (errors, Some(result))
              )
      .flatMap:
        case (_, Some(result)) => ZIO.succeed(result)
        case (errors, None) => ZIO.fail(EngineError.ProcessError(s"All services failed for $operationName: ${errors.map(_.errorMsg).mkString("; ")}"))
