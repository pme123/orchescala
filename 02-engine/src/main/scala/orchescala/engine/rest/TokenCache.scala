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

  def ttlFor(expiresIn: Option[Long]): FiniteDuration =
    expiresIn
      .map: seconds =>
        val lifetime = seconds.seconds
        // keep the safety margin, but for short-lived tokens fall back to half the
        // lifetime - the cache must never serve a token past its actual expiry
        (lifetime - safetyMargin).max(lifetime / 2).max(Duration.Zero)
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
