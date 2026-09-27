package orchescala.worker

import orchescala.domain.{IdentityCorrelation, IdentityCorrelationSigner}
import zio.*
import zio.test.*

import java.util.concurrent.atomic.AtomicInteger

object IdentityBindingSpec extends ZIOSpecDefault:

  private val key = "signing-key"

  /** Signed by the engine for `processInstanceId` - as the gateway does after the start. */
  private def correlationOf(processInstanceId: String) =
    IdentityCorrelationSigner.sign(IdentityCorrelation("alice"), processInstanceId, key)

  /** The job's instance, its root and how often the root was looked up. */
  private def job(id: String, root: Either[String, Option[String]]) =
    val lookups = AtomicInteger(0)
    JobProcessInstance(id, ZIO.succeed(lookups.incrementAndGet()) *> ZIO.fromEither(root)) -> lookups

  def spec = suite("IdentityVerification.verifyBinding")(
    test("bound to the job's own process instance - no root lookup") {
      val (instance, lookups) = job("pi-1", Left("must not be called"))
      for result <- IdentityVerification.verifyBinding(correlationOf("pi-1"), instance).exit
      yield assertTrue(result.isSuccess, lookups.get == 0)
    },
    test("a call activity: bound to the root of the job's process instance") {
      val (instance, lookups) = job("child-1", Right(Some("root-1")))
      for result <- IdentityVerification.verifyBinding(correlationOf("root-1"), instance).exit
      yield assertTrue(result.isSuccess, lookups.get == 1)
    },
    test("copied from another process: rejected, although its signature is valid") {
      val alices = correlationOf("alice-process")
      val (instance, _) = job("bob-process", Right(Some("bob-process")))
      for
        signatureOk <- IdentityVerification.verifySignature(alices, Some(key)).exit
        binding     <- IdentityVerification.verifyBinding(alices, instance).exit
      yield assertTrue(signatureOk.isSuccess, binding.isFailure) // before: only the signature was checked
    },
    test("root lookup fails: rejected") {
      val (instance, _) = job("child-1", Left("engine down"))
      for result <- IdentityVerification.verifyBinding(correlationOf("root-1"), instance).exit
      yield assertTrue(result.isFailure)
    },
    test("not bound to any process instance: rejected") {
      val (instance, _) = job("pi-1", Right(None))
      for result <- IdentityVerification.verifyBinding(IdentityCorrelation("alice"), instance).exit
      yield assertTrue(result.isFailure)
    }
  )
end IdentityBindingSpec
