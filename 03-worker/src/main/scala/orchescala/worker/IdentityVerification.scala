package orchescala.worker

import orchescala.domain.{GeneralVariables, IdentityCorrelation, IdentityCorrelationSigner}
import orchescala.worker.WorkerError.{BadSignatureError, UnexpectedError}
import zio.{IO, ZIO}

/** Helper utilities for verifying IdentityCorrelation in workers.
  *
  * Workers should use these methods to verify that the IdentityCorrelation has not been tampered
  * with and is bound to the correct process instance.
  */
object IdentityVerification:

  /** Verify that an IdentityCorrelation has a valid signature for the given process instance.
    *
    * This should be called by workers that need to ensure the identity has not been tampered with
    * or copied from another process.
    *
    * @param correlation
    *   The identity correlation to verify
    * @param secretKeyOpt
    *   The secret key used for signing (should match the engine's key)
    * @return
    *   Success if valid, UnexpectedError if invalid
    *
    * @example
    *   ```scala
    *   for
    *     correlation <- getIdentityCorrelation()
    *     _           <- IdentityVerification.verifySignature(
    *                      correlation,
    *                      engineConfig.identitySigningKey
    *                    )
    *   // ... continue with authorized work
    *   yield result
    *   end for
    *   ```
    */
  def verifySignature(
      correlation: IdentityCorrelation,
      secretKeyOpt: Option[String]
  ): IO[BadSignatureError, Unit] =
    // Get processInstanceId from context
    (correlation.processInstanceId, correlation.signature, secretKeyOpt) match
      case (None, _, _)                                                =>
        // Correlation exists but has no processInstanceId - log warning
        ZIO.fail:
          WorkerError.BadSignatureError(
            "IdentityCorrelation present but not bound to a process instance."
          )
      case (_, None, _)                                                =>
        ZIO.fail(
          BadSignatureError(
            "IdentityCorrelation has no signature - cannot verify authenticity"
          )
        )
      case (_, _, None)                                                =>
        ZIO.fail:
          WorkerError.BadSignatureError(
            "IdentityCorrelation present but secret key is missing (`engineConfig.identitySigningKey`)."
          )
      case (Some(processInstanceId), Some(signature), Some(secretKey)) =>
        // Verify the signature
        val isValid = IdentityCorrelationSigner.verify(
          correlation,
          processInstanceId,
          signature,
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
        end if
  end verifySignature

  /** Checks that the correlation belongs to the job: bound to the job's process instance or to its
    * root (call activities inherit the correlation of their parent). The signature alone is not
    * enough - it only proves that the engine signed the correlation for the process instance
    * stored IN it, so a correlation copied from another process passed as well.
    */
  def verifyBinding(
      correlation: IdentityCorrelation,
      job: JobProcessInstance
  ): IO[BadSignatureError, Unit] =
    correlation.processInstanceId match
      case None                           =>
        ZIO.fail(BadSignatureError("IdentityCorrelation present but not bound to a process instance."))
      case Some(bound) if bound == job.id => ZIO.unit
      case Some(bound)                    =>
        job.rootId
          .mapError: err =>
            BadSignatureError(
              s"Could not look up the root process instance of '${job.id}' to verify the IdentityCorrelation: $err"
            )
          .flatMap:
            case Some(root) if root == bound => ZIO.unit
            case root                        =>
              ZIO.fail(BadSignatureError(
                s"IdentityCorrelation is bound to process instance '$bound', not to the job's " +
                  s"'${job.id}' (root: ${root.getOrElse("-")}) - copied from another process?"
              ))
  end verifyBinding

  /** Verify signature if a signing key is available, otherwise just log a warning.
    *
    * This is useful during migration or in environments where signing is optional.
    *
    * @param correlation
    *   The identity correlation to verify
    * @param secretKeyOpt
    *   Optional secret key - if None, verification is skipped
    * @return
    *   Success (always succeeds, but logs warning if verification fails)
    */
  def verifySignatureOptional(
      correlation: IdentityCorrelation,
      secretKeyOpt: Option[String]
  ): ZIO[Any, Nothing, Unit] =
    verifySignature(correlation, secretKeyOpt)
      .foldZIO(
        err => ZIO.logWarning(s"IdentityCorrelation verification failed: ${err.errorMsg}"),
        _ => ZIO.unit
      )
  end verifySignatureOptional

  /** Started with an identity whose signed correlation follows the start (it needs the process
    * instance id), and the job was fetched in between: it ran without the user's identity (or failed
    * a required verification). Handed back to be tried again shortly.
    */
  def notPending(generalVariables: GeneralVariables): IO[WorkerError.IdentityCorrelationPendingError, Unit] =
    ZIO
      .fail(WorkerError.IdentityCorrelationPendingError())
      .when(
        generalVariables._identityCorrelationPending.contains(true) &&
          generalVariables._identityCorrelation.isEmpty
      )
      .unit

end IdentityVerification
