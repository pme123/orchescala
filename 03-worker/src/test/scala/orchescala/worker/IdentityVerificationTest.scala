package orchescala.worker

import munit.FunSuite
import orchescala.domain.{IdentityCorrelation, IdentityCorrelationSigner}
import orchescala.worker.WorkerError.BadSignatureError
import zio.{Runtime, Unsafe, ZIO}

class IdentityVerificationTest extends FunSuite:

  val runtime = Runtime.default

  // Helper to run ZIO effects synchronously in tests
  def runZIO[E, A](zio: ZIO[Any, E, A]): Either[E, A] =
    Unsafe.unsafe { implicit unsafe =>
      runtime.unsafe.run(zio.either).getOrThrowFiberFailure()
    }

  val testUsername = "testuser"
  val testEmail = Some("test@example.com")
  val testProcessInstanceId = "process-123"
  val testSecretKey = "test-secret-key"
  val wrongSecretKey = "wrong-secret-key"

  test("verifySignature succeeds with valid signature"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = testEmail
      ),
      testProcessInstanceId,
      testSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignature(correlation, Some(testSecretKey)))
    
    assert(result.isRight)

  test("verifySignature fails when processInstanceId is missing"):
    val correlation = IdentityCorrelation(
      username = testUsername,
      email = testEmail,
      processInstanceId = None
    )

    val result = runZIO(IdentityVerification.verifySignature(correlation, Some(testSecretKey)))
    
    assert(result.isLeft)
    result match
      case Left(error: BadSignatureError) =>
        assertEquals(
          error.errorMsg,
          "IdentityCorrelation present but not bound to a process instance."
        )
      case _ => fail("Expected BadSignatureError")

  test("verifySignature fails when signature is missing"):
    val correlation = IdentityCorrelation(
      username = testUsername,
      email = testEmail,
      processInstanceId = Some(testProcessInstanceId),
      signature = None
    )

    val result = runZIO(IdentityVerification.verifySignature(correlation, Some(testSecretKey)))
    
    assert(result.isLeft)
    result match
      case Left(error: BadSignatureError) =>
        assertEquals(
          error.errorMsg,
          "IdentityCorrelation has no signature - cannot verify authenticity"
        )
      case _ => fail("Expected BadSignatureError")

  test("verifySignature fails when secret key is missing"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = testEmail
      ),
      testProcessInstanceId,
      testSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignature(correlation, None))
    
    assert(result.isLeft)
    result match
      case Left(error: BadSignatureError) =>
        assertEquals(
          error.errorMsg,
          "IdentityCorrelation present but secret key is missing (`engineConfig.identitySigningKey`)."
        )
      case _ => fail("Expected BadSignatureError")

  test("verifySignature fails with invalid signature"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = testEmail
      ),
      testProcessInstanceId,
      wrongSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignature(correlation, Some(testSecretKey)))
    
    assert(result.isLeft)
    result match
      case Left(error: BadSignatureError) =>
        assertEquals(
          error.errorMsg,
          "IdentityCorrelation signature is invalid - possible tampering detected"
        )
      case _ => fail("Expected BadSignatureError")

  test("verifySignature succeeds with all optional fields"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = testEmail,
        impersonateProcessValue = Some("customer-456")
      ),
      testProcessInstanceId,
      testSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignature(correlation, Some(testSecretKey)))
    
    assert(result.isRight)

  test("verifySignatureOptional succeeds with valid signature"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = testEmail
      ),
      testProcessInstanceId,
      testSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignatureOptional(correlation, Some(testSecretKey)))
    
    assert(result.isRight)

  test("verifySignatureOptional succeeds but logs warning when processInstanceId is missing"):
    val correlation = IdentityCorrelation(
      username = testUsername,
      email = testEmail,
      processInstanceId = None
    )

    // verifySignatureOptional never fails, it just logs warnings
    val result = runZIO(IdentityVerification.verifySignatureOptional(correlation, Some(testSecretKey)))

    assert(result.isRight)

  test("verifySignatureOptional succeeds but logs warning when signature is missing"):
    val correlation = IdentityCorrelation(
      username = testUsername,
      email = testEmail,
      processInstanceId = Some(testProcessInstanceId),
      signature = None
    )

    val result = runZIO(IdentityVerification.verifySignatureOptional(correlation, Some(testSecretKey)))

    assert(result.isRight)

  test("verifySignatureOptional succeeds but logs warning when secret key is missing"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = testEmail
      ),
      testProcessInstanceId,
      testSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignatureOptional(correlation, None))

    assert(result.isRight)

  test("verifySignatureOptional succeeds but logs warning with invalid signature"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = testEmail
      ),
      testProcessInstanceId,
      wrongSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignatureOptional(correlation, Some(testSecretKey)))

    assert(result.isRight)

  test("verifySignature detects tampering when username is modified"):
    val originalCorrelation = IdentityCorrelation(
      username = testUsername,
      email = testEmail
    )

    val signedCorrelation = IdentityCorrelationSigner.sign(
      originalCorrelation,
      testProcessInstanceId,
      testSecretKey
    )

    // Tamper with the username while keeping the signature
    val tamperedCorrelation = signedCorrelation.copy(username = "hacker")

    val result = runZIO(IdentityVerification.verifySignature(tamperedCorrelation, Some(testSecretKey)))

    assert(result.isLeft)
    result match
      case Left(error: BadSignatureError) =>
        assertEquals(
          error.errorMsg,
          "IdentityCorrelation signature is invalid - possible tampering detected"
        )
      case _ => fail("Expected BadSignatureError")

  test("verifySignature detects tampering when email is modified"):
    val originalCorrelation = IdentityCorrelation(
      username = testUsername,
      email = testEmail
    )

    val signedCorrelation = IdentityCorrelationSigner.sign(
      originalCorrelation,
      testProcessInstanceId,
      testSecretKey
    )

    // Tamper with the email while keeping the signature
    val tamperedCorrelation = signedCorrelation.copy(email = Some("hacker@evil.com"))

    val result = runZIO(IdentityVerification.verifySignature(tamperedCorrelation, Some(testSecretKey)))

    assert(result.isLeft)
    result match
      case Left(error: BadSignatureError) =>
        assertEquals(
          error.errorMsg,
          "IdentityCorrelation signature is invalid - possible tampering detected"
        )
      case _ => fail("Expected BadSignatureError")

  test("verifySignature detects tampering when processInstanceId is modified"):
    val originalCorrelation = IdentityCorrelation(
      username = testUsername,
      email = testEmail
    )

    val signedCorrelation = IdentityCorrelationSigner.sign(
      originalCorrelation,
      testProcessInstanceId,
      testSecretKey
    )

    // Tamper with the processInstanceId while keeping the signature
    val tamperedCorrelation = signedCorrelation.copy(processInstanceId = Some("different-process-999"))

    val result = runZIO(IdentityVerification.verifySignature(tamperedCorrelation, Some(testSecretKey)))

    assert(result.isLeft)
    result match
      case Left(error: BadSignatureError) =>
        assertEquals(
          error.errorMsg,
          "IdentityCorrelation signature is invalid - possible tampering detected"
        )
      case _ => fail("Expected BadSignatureError")

  test("verifySignature succeeds with minimal correlation"):
    val correlation = IdentityCorrelationSigner.sign(
      IdentityCorrelation(
        username = testUsername,
        email = None,
        impersonateProcessValue = None
      ),
      testProcessInstanceId,
      testSecretKey
    )

    val result = runZIO(IdentityVerification.verifySignature(correlation, Some(testSecretKey)))

    assert(result.isRight)

end IdentityVerificationTest

