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
    case Nil => ZIO.fail(EngineError.ProcessError("No services available"))
    case _   =>
      ZIO.logDebug(s"Services for $operationName: ${sortedServices.map(_.engineType).mkString(", ")}") *>
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
                  .fold(
                    error => (errors :+ error, None, None),
                    result => (errors, Some(result), Some(service.engineType))
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
            case (errors, _, _)                   => ZIO.fail(EngineError.ProcessError(
                s"All services failed for $operationName: ${errors.map(_.errorMsg).mkString("; ")}"
              ))

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
    case uuidRegex() => Some(EngineType.C8)
    case str if str.toLongOption.isDefined => Some(EngineType.C7)
    case _ => None