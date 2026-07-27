package orchescala.engine.rest

import com.github.blemale.scaffeine.{Cache, Scaffeine}

import scala.concurrent.duration.*

object TokenCache:

  final case class TokenEntry(token: String, ttl: FiniteDuration)

  // used when the identity provider does not return an expires_in
  private val defaultTtl   = 4.minutes
  // expire before the token actually does, so requests never run with a token
  // that dies mid-flight
  private val safetyMargin = 30.seconds
  private val minTtl       = 30.seconds

  def ttlFor(expiresIn: Option[Long]): FiniteDuration =
    expiresIn
      .map(seconds => (seconds.seconds - safetyMargin).max(minTtl))
      .getOrElse(defaultTtl)

  def get(key: String): Option[String] =
    cache.getIfPresent(key).map(_.token)

  def put(key: String, token: String, expiresIn: Option[Long]): Unit =
    cache.put(key, TokenEntry(token, ttlFor(expiresIn)))

  lazy val cache: Cache[String, TokenEntry] =
    Scaffeine()
      .recordStats()
      // expire each token according to its own lifetime (expires_in) instead of a fixed write TTL
      .expireAfter[String, TokenEntry](
        create = (_, entry) => entry.ttl,
        update = (_, entry, _) => entry.ttl,
        read = (_, _, currentDuration) => currentDuration
      )
      .maximumSize(1000)
      .build[String, TokenEntry]()
end TokenCache
