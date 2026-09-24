package orchescala.engine.rest

import munit.FunSuite

class TokenFingerprintTest extends FunSuite:

  private val token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2lnbmF0dXJlLXBhcnQ"

  test("reveals no part of the token"):
    val fingerprint = TokenFingerprint(token)
    assert(fingerprint.startsWith("sha256:"))
    assertEquals(fingerprint.length, "sha256:".length + 12)
    token.split('.').foreach(part => assert(!fingerprint.contains(part.take(5))))

  test("stable for the same token, different for another"):
    assertEquals(TokenFingerprint(token), TokenFingerprint(token))
    assertNotEquals(TokenFingerprint(token), TokenFingerprint(token + "x"))

  test("OAuthConfig.toString shows no secret and no password"):
    val config = OAuthConfig.PasswordGrant("realm", "http://sso", "client", "s3cr3t-value", "openid", "alice", "pa55word")
    assert(!config.toString.contains("s3cr3"), config.toString)
    assert(!config.toString.contains("pa55"), config.toString)

end TokenFingerprintTest
