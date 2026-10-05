package orchescala.persistence

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import zio.test.*

object PersistenceWorkerDslSpec extends ZIOSpecDefault:

  private def token(claims: (String, String)*) =
    claims.foldLeft(JWT.create())((jwt, claim) => jwt.withClaim(claim._1, claim._2))
      .sign(Algorithm.HMAC256("test-only"))

  def spec = suite("PersistenceWorkerDsl")(
    test("the user of the audit log is the preferred_username of the token") {
      assertTrue(
        PersistenceWorkerDsl.userOf(
          token("preferred_username" -> "anna.berater")
        ).contains("anna.berater"),
        PersistenceWorkerDsl.userOf(token("sub" -> "123")).isEmpty,
        PersistenceWorkerDsl.userOf(token("preferred_username" -> "")).isEmpty,
        PersistenceWorkerDsl.userOf("no-jwt").isEmpty
      )
    },
    test("an unverified user is marked as such in the audit log") {
      assertTrue(
        PersistenceWorkerDsl.auditUser(Some("anna"), unverified = false).contains("anna"),
        PersistenceWorkerDsl.auditUser(Some("anna"), unverified = true).contains("unverified:anna"),
        PersistenceWorkerDsl.auditUser(None, unverified = true).isEmpty
      )
    },
    test("store errors reach the caller without database details") {
      assertTrue(
        PersistenceError.StoreError(
          "Database error on notiz - see the log of the worker app"
        ).message ==
          "Database error on notiz - see the log of the worker app",
        PersistenceError.VersionConflict("notiz", "n1", Some(1), Some(2)).message ==
          "notiz 'n1' was changed in the meantime (version 1, now 2)"
      )
    }
  )
end PersistenceWorkerDslSpec
