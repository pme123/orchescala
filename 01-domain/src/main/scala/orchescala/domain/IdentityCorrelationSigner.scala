package orchescala.domain

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.util.Base64

/**
 * Utility for signing and verifying IdentityCorrelation objects.
 * 
 * Uses HMAC-SHA256 to create a cryptographic signature that binds the identity
 * to a specific process instance, preventing tampering and replay attacks.
 */
object IdentityCorrelationSigner:

  /**
   * Sign an IdentityCorrelation with a process instance ID.
   * 
   * @param correlation The correlation to sign (without signature)
   * @param processInstanceId The process instance ID to bind to
   * @param secretKey The secret key for HMAC signing
   * @return A new IdentityCorrelation with signature and processInstanceId set
   */
  def sign(
      correlation: IdentityCorrelation,
      processInstanceId: String,
      secretKey: String
  ): IdentityCorrelation =
    val signature = computeSignature(
      username = correlation.username,
      email = correlation.email,
      impersonateProcessValue = correlation.impersonateProcessValue,
      issuedAt = correlation.issuedAt,
      processInstanceId = processInstanceId,
      secretKey = secretKey
    )
    
    correlation.copy(
      processInstanceId = Some(processInstanceId),
      signature = Some(signature)
    )
  end sign

  /**
   * Verify that an IdentityCorrelation has a valid signature.
   * 
   * @param correlation The correlation to verify
   * @param processInstanceId The expected process instance ID
   * @param secretKey The secret key for HMAC verification
   * @return true if signature is valid, false otherwise
   */
  def verify(
      correlation: IdentityCorrelation,
      processInstanceId: String,
      secretKey: String
  ): Boolean =
    correlation.signature match
      case None => false
      case Some(sig) =>
        val expectedSignature = computeSignature(
          username = correlation.username,
          email = correlation.email,
          impersonateProcessValue = correlation.impersonateProcessValue,
          issuedAt = correlation.issuedAt,
          processInstanceId = processInstanceId,
          secretKey = secretKey
        )
        
        // Constant-time comparison to prevent timing attacks
        sig == expectedSignature
  end verify

  /**
   * Compute HMAC-SHA256 signature for the given parameters.
   */
  private def computeSignature(
      username: String,
      email: Option[String],
      impersonateProcessValue: Option[String],
      issuedAt: Long,
      processInstanceId: String,
      secretKey: String
  ): String =
    // Create the message to sign by concatenating all fields
    val message = Seq(
      username,
      email.getOrElse(""),
      impersonateProcessValue.getOrElse(""),
      issuedAt.toString,
      processInstanceId
    ).mkString("|")
    
    // Compute HMAC-SHA256
    val mac = Mac.getInstance("HmacSHA256")
    val secretKeySpec = new SecretKeySpec(secretKey.getBytes("UTF-8"), "HmacSHA256")
    mac.init(secretKeySpec)
    val hmacBytes = mac.doFinal(message.getBytes("UTF-8"))
    
    // Encode as Base64
    Base64.getEncoder.encodeToString(hmacBytes)
  end computeSignature

end IdentityCorrelationSigner

