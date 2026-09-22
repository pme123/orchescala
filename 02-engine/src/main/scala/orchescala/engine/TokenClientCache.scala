package orchescala.engine

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** One engine client per bearer token, shared by all requests carrying that token.
  *
  * The engine SDK clients fix their credentials at build time, so a pass-through token cannot be
  * swapped on a single shared client - but building a client per request leaks its connection
  * pool / gRPC channel / threads on every call. This keeps one client per token and closes clients
  * that have not been used for `idleTtlMillis` on the next access.
  *
  * @param build
  *   builds the client for a token
  * @param close
  *   releases the client's resources
  */
final class TokenClientCache[Client](
    build: String => Client,
    close: Client => Unit,
    idleTtlMillis: Long,
    clientTypeName: String
):

  private case class Entry(client: Client, lastUsed: AtomicLong)

  private val entries = new ConcurrentHashMap[String, Entry]()

  /** The client for `token`, built on first use. */
  def get(token: String): Client =
    val now = System.currentTimeMillis()
    evictIdle(now)
    val entry = entries.computeIfAbsent(token, _ => Entry(build(token), new AtomicLong(now)))
    entry.lastUsed.set(now)
    entry.client
  end get

  /** Closes and drops every cached client - e.g. on shutdown. */
  def closeAll(): Unit =
    entries.forEach: (token, entry) =>
      if entries.remove(token, entry) then closeQuietly(entry.client)

  def size: Int = entries.size

  private def evictIdle(now: Long): Unit =
    entries.forEach: (token, entry) =>
      if now - entry.lastUsed.get >= idleTtlMillis && entries.remove(token, entry)
      then closeQuietly(entry.client)

  private def closeQuietly(client: Client): Unit =
    try close(client)
    catch case ex: Throwable => println(s"Problem closing $clientTypeName token client: $ex")

end TokenClientCache

object TokenClientCache:
  val defaultIdleTtlMillis: Long = java.time.Duration.ofMinutes(10).toMillis
