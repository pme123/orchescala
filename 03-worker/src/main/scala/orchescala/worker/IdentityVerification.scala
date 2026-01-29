package orchescala.worker

import orchescala.domain.{IdentityCorrelation, IdentityCorrelationSigner}
import orchescala.worker.WorkerError.{BadSignatureError, UnexpectedError}
import zio.{IO, ZIO}

/**
 * Helper utilities for verifying IdentityCorrelation in workers.
 * 
 * Workers should use these methods to verify that the IdentityCorrelation
 * has not been tampered with and is bound to the correct process instance.
 */
object IdentityVerification:

  /**
   * Verify that an IdentityCorrelation has a valid signature for the given process instance.
   *
   * This should be called by workers that need to ensure the identity has not been
   * tampered with or copied from another process.
   *
   * @param correlation The identity correlation to verify
   * @param processInstanceId The current process instance ID
   * @param secretKey The secret key used for signing (should match the engine's key)
   * @return Success if valid, UnexpectedError if invalid
   *
   * @example
   * ```scala
   * for
   *   correlation <- getIdentityCorrelation()
   *   _           <- IdentityVerification.verifySignature(
   *                    correlation,
   *                    processInstanceId,
   *                    sys.env("ORCHESCALA_IDENTITY_SIGNING_KEY")
   *                  )
   *   // ... continue with authorized work
   * yield result
   * ```
   */
  def verifySignature(
      correlation: IdentityCorrelation,
      processInstanceId: String,
      secretKey: String
  ): IO[BadSignatureError, Unit] =
    // Check if correlation has a signature
    correlation.signature match
      case None =>
        ZIO.fail(
          BadSignatureError(
            "IdentityCorrelation has no signature - cannot verify authenticity"
          )
        )

      case Some(_) =>
        // Check if processInstanceId matches
        correlation.processInstanceId match
          case None =>
            ZIO.fail(
              BadSignatureError(
                "IdentityCorrelation is not bound to a process instance"
              )
            )

          case Some(correlationPid) if correlationPid != processInstanceId =>
            ZIO.fail(
              BadSignatureError(
                s"IdentityCorrelation is bound to process '$correlationPid' but current process is '$processInstanceId'"
              )
            )

          case Some(_) =>
            // Verify the signature
            val isValid = IdentityCorrelationSigner.verify(
              correlation,
              processInstanceId,
              secretKey
            )

            if isValid then
              ZIO.unit
            else
              ZIO.fail(
                BadSignatureError(
                  "IdentityCorrelation signature is invalid - possible tampering detected"
                )
              )
  end verifySignature

  /**
   * Verify signature if a signing key is available, otherwise just log a warning.
   *
   * This is useful during migration or in environments where signing is optional.
   *
   * @param correlation The identity correlation to verify
   * @param processInstanceId The current process instance ID
   * @param secretKeyOpt Optional secret key - if None, verification is skipped
   * @return Success (always succeeds, but logs warning if verification fails)
   */
  def verifySignatureOptional(
      correlation: IdentityCorrelation,
      processInstanceId: String,
      secretKeyOpt: Option[String]
  ): ZIO[Any, Nothing, Unit] =
    secretKeyOpt match
      case None =>
        ZIO.logWarning(
          "No signing key configured - skipping IdentityCorrelation verification"
        )

      case Some(secretKey) =>
        verifySignature(correlation, processInstanceId, secretKey)
          .foldZIO(
            err => ZIO.logWarning(s"IdentityCorrelation verification failed: ${err.errorMsg}"),
            _ => ZIO.unit
          )
  end verifySignatureOptional

end IdentityVerification

