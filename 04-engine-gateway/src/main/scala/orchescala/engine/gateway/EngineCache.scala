package orchescala.engine.gateway

import com.github.blemale.scaffeine.{Cache, Scaffeine}
import orchescala.engine.domain.EngineType

import scala.concurrent.duration.*

object EngineCache:

  private lazy val cache: Cache[String, EngineType] =
    Scaffeine()
      .recordStats()
      .expireAfterWrite(15.minutes)
      .maximumSize(100)
      .build[String, EngineType]()

  def updateCache(
      key: String,
      engineType: EngineType
  ): Unit =
    cache.put(
      key,
      engineType
    )
  end updateCache

  def getIfPresent(key: String): Option[EngineType] =
    cache.getIfPresent(key)
  end getIfPresent

  def asMap(): Map[String, EngineType] =
    cache.asMap().toMap
  end asMap

  def invalidateAll(): Unit =
    cache.invalidateAll()
end EngineCache
