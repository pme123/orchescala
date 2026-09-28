package orchescala.engine.gateway

import orchescala.engine.domain.{EngineError, EngineType}
import orchescala.engine.services.{EngineService, ProcessInstanceService}
import zio.{IO, ZIO}

private val uuidRegex =
  """^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$""".r

private[gateway] def tryServicesWithErrorCollection[S <: EngineService, A](
    operation: S => IO[EngineError, A],
    operationName: String,
    cacheGetKey: Option[String] = None,
    cacheUpdateKey: Option[A => String] = None
)(using services: Seq[S]): IO[EngineError, A] =
  val sortedServices = services.sortedFromCache(cacheGetKey)
  sortedServices match
    case Nil =>
      ZIO.logError(s"No services available for $operationName") *>
        ZIO.fail(EngineError.ProcessError("No services available"))
    case _   =>
      ZIO.logInfo(
        s"Services for $operationName: ${sortedServices.map(_.engineType).mkString(", ")}"
      ) *>
        sortedServices
          .foldLeft(ZIO.succeed((
            List.empty[EngineError],
            Option.empty[A],
            Option.empty[EngineType]
          ))): (acc, service) =>
            acc.flatMap:
              case (errors, Some(result), engineType) =>
                ZIO.succeed((errors, Some(result), engineType))
              case (errors, None, _)                  =>
                operation(service)
                  .foldZIO(
                    error =>
                      ZIO.logWarning(
                        s"$operationName failed for ${service.engineType}: ${error.errorMsg}"
                      ).as((errors :+ error, None, None)),
                    result => ZIO.succeed((errors, Some(result), Some(service.engineType)))
                  )
          .flatMap:
            case (_, Some(result), Some(engineType)) =>
              ZIO
                .attempt(cacheUpdateKey.foreach(f =>
                  EngineCache.updateCache(f(result), engineType)
                ))
                .zipLeft(ZIO.logDebug(
                  s"Cache updated for $operationName (${cacheUpdateKey.map(f => f(result)).getOrElse("-")}): $engineType"
                ))
                .mapError(ex =>
                  EngineError.ProcessError(s"Problem updating cache: ${ex.getMessage}")
                ).as(result)
            case (errors, _, _)                      => ZIO.fail(allServicesFailed(operationName, errors))
  end match
end tryServicesWithErrorCollection

/** The error when no engine could do it.
  *
  * All of them answered with a client error (4xx): that status - the most specific one, as a 404
  * of an engine only says the id is not one of its own (e.g. 401 of C7, 404 of C8 -> 401). Else
  * (an engine not reachable, a 5xx, ...): 500 as before - every failure became a 500, so an
  * unknown id or a rejected token looked like a gateway error.
  */
private[gateway] def allServicesFailed(operationName: String, errors: Seq[EngineError]): EngineError =
  val message      = s"All services failed for $operationName: ${errors.map(_.errorMsg).mkString("; ")}"
  val clientErrors = errors.collect:
    case EngineError.ServiceRequestError(code, _) if code >= 400 && code < 500 => code
  if errors.nonEmpty && clientErrors.size == errors.size then
    EngineError.ServiceRequestError(clientErrors.find(_ != 404).getOrElse(404), message)
  else EngineError.ProcessError(message)
end allServicesFailed

extension [S <: EngineService](services: Seq[S])
  private def sortedFromCache(cacheGetKey: Option[String]): Seq[S] =
    cacheGetKey
      .map: key =>
        // check first if we have a cache entry
        val fromCachServices = services
          .map: s =>
            EngineCache.getIfPresent(key).map(_ == s.engineType) -> s

        if fromCachServices.exists(_._1.contains(true)) then
          fromCachServices
            .sortBy(!_._1.contains(true))
            .map(_._2)
        else
          val engineType = // only works as long we have ids that we can separate
            engineTypeForKey(key)
          services
            .sortBy: s =>
              !engineType.contains(s.engineType)
        end if
      .getOrElse(services)

end extension

def engineTypeForKey(key: String) =
  key match
    case uuidRegex()                       => Some(EngineType.C8)
    case str if str.toLongOption.isDefined => Some(EngineType.C7)
    case _                                 => None
