package orchescala.engine.rest

import java.security.MessageDigest

/** A token for logs: the first characters of its SHA-256 hash.
  *
  * Enough to tell tokens apart and follow one through the logs, without revealing any part of it -
  * the last characters of a JWT belong to its signature, the first ones are the same for every
  * token (`eyJhbGci...`).
  */
object TokenFingerprint:

  def apply(token: String): String =
    MessageDigest
      .getInstance("SHA-256")
      .digest(token.getBytes("UTF-8"))
      .take(6)
      .map("%02x".format(_))
      .mkString("sha256:", "", "")

end TokenFingerprint
