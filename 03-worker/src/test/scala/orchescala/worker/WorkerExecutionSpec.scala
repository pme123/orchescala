package orchescala.worker

import orchescala.domain.{NoInput, NoOutput}
import zio.*
import zio.test.*

import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}
import java.util.concurrent.{CountDownLatch, TimeUnit}
import scala.concurrent.duration as scalaDuration

object WorkerExecutionSpec extends ZIOSpecDefault:

  /** A worker exposing BaseWorker's execution - the job is whatever the test passes. */
  private class TestWorker(timeout: Duration = 5.seconds, lock: Duration = 1.minute)
      extends BaseWorker[NoInput, NoOutput]:
    def worker: Worker[NoInput, NoOutput, ?]    = null
    override protected def workerTimeout: Duration = timeout
    override private[worker] def lockTimeout: Duration = lock
    override private[worker] def lockExpiryMargin: Duration = lock.dividedBy(20)

    def blocking(
        job: Task[Unit],
        onTimeout: UIO[Unit] = ZIO.unit,
        renewLock: UIO[Unit] = ZIO.unit,
        lockExpiresAt: Option[Long] = None
    ): Unit =
      executeBlocking("job")(job, onTimeout, renewLock, lockExpiresAt)

    def forked(job: Task[Unit], permits: Option[JobPermits], onNoPermit: UIO[Unit] = ZIO.unit): Unit =
      executeForked("job")(job, permits = permits, onNoPermit = onNoPermit)
  end TestWorker

  def spec = suite("BaseWorker execution")(
    suite("blocking (C8)")(
      test("returns only when the job is done - the client keeps its slot until then") {
        val done = AtomicBoolean(false)
        for _ <- ZIO.attemptBlocking(TestWorker().blocking(ZIO.sleep(200.millis) *> ZIO.succeed(done.set(true))))
        yield assertTrue(done.get) // before: returned at once, the job still running
      },
      test("a job running past workerTimeout is reported as failed") {
        val failed = AtomicBoolean(false)
        for _ <- ZIO.attemptBlocking(
                   TestWorker(timeout = 100.millis).blocking(ZIO.never, ZIO.succeed(failed.set(true)))
                 )
        yield assertTrue(failed.get) // before: only logged - the engine handed the job out again
      },
      test("a fast job never renews its lock - no race with its completion") {
        val renewals = AtomicInteger(0)
        for _ <- ZIO.attemptBlocking(
                   TestWorker().blocking(
                     ZIO.sleep(50.millis),
                     renewLock = ZIO.succeed(renewals.incrementAndGet()).unit,
                     lockExpiresAt = Some(java.lang.System.currentTimeMillis() + 60_000)
                   )
                 )
        yield assertTrue(renewals.get == 0) // before: renewed at once - raced the completion
      },
      test("a long job renews its lock when it runs low, then regularly") {
        val renewals = AtomicInteger(0)
        val ran      = AtomicBoolean(false)
        for _ <- ZIO.attemptBlocking(
                   // lock 1s -> renewed when <500ms are left, then every 500ms; runs 1.7s
                   TestWorker(lock = 1.second).blocking(
                     ZIO.succeed(ran.set(true)) *> ZIO.sleep(1700.millis),
                     renewLock = ZIO.succeed(renewals.incrementAndGet()).unit,
                     lockExpiresAt = Some(java.lang.System.currentTimeMillis() + 1000)
                   )
                 )
        yield assertTrue(ran.get, renewals.get >= 2) // ~0.5s, ~1s, ~1.5s
      },
      test("a job that waited long renews at once - its lock runs low") {
        val renewals = AtomicInteger(0)
        for _ <- ZIO.attemptBlocking(
                   TestWorker(lock = 1.minute).blocking(
                     ZIO.sleep(100.millis),
                     renewLock = ZIO.succeed(renewals.incrementAndGet()).unit,
                     lockExpiresAt = Some(java.lang.System.currentTimeMillis() + 20_000) // < 30s left
                   )
                 )
        yield assertTrue(renewals.get == 1)
      },
      test("renewing stops when the job is done") {
        val renewals = AtomicInteger(0)
        for
          _     <- ZIO.attemptBlocking(
                     TestWorker(lock = 200.millis)
                       .blocking(ZIO.unit, renewLock = ZIO.succeed(renewals.incrementAndGet()).unit)
                   )
          after <- ZIO.succeed(renewals.get)
          _     <- ZIO.sleep(300.millis)
        yield assertTrue(renewals.get == after)
      },
      test("a job whose lock ran out while it waited is not run - the engine hands it out again") {
        val ran = AtomicBoolean(false)
        for _ <- ZIO.attemptBlocking(
                   TestWorker().blocking(
                     ZIO.succeed(ran.set(true)),
                     lockExpiresAt = Some(java.lang.System.currentTimeMillis() - 1000)
                   )
                 )
        yield assertTrue(!ran.get)
      },
      test("a defect is rethrown - the C8 client then fails the job") {
        for exit <- ZIO.attemptBlocking(TestWorker().blocking(ZIO.die(RuntimeException("bug")))).exit
        yield assertTrue(exit.isFailure)
      }
    ),
    suite("forked with permits (C7 / Op)")(
      test("at most maxJobs jobs run at once, all of them run") {
        val permits  = JobPermits(maxJobs = 2, maxWait = scalaDuration.Duration(5, "seconds"))
        val running  = AtomicInteger(0)
        val maxSeen  = AtomicInteger(0)
        val finished = CountDownLatch(6)
        val job      =
          ZIO.succeed(maxSeen.accumulateAndGet(running.incrementAndGet(), math.max)) *>
            ZIO.sleep(100.millis) *>
            ZIO.succeed:
              running.decrementAndGet()
              finished.countDown()
        val worker   = TestWorker()
        for
          // like the client's thread: the handlers one after the other
          _ <- ZIO.attemptBlocking((1 to 6).foreach(_ => worker.forked(job, Some(permits))))
          _ <- ZIO.attemptBlocking(finished.await(10, TimeUnit.SECONDS))
          // released right after the job (ensuring) - not yet when its last step counted down
          _ <- ZIO.succeed(permits.available).repeatUntil(_ == 2).timeout(5.seconds)
        yield assertTrue(maxSeen.get == 2, finished.getCount == 0, permits.available == 2)
      },
      test("no permit within maxWait: the job goes back to the engine") {
        val permits  = JobPermits(maxJobs = 1, maxWait = scalaDuration.Duration(100, "millis"))
        val unlocked = AtomicBoolean(false)
        val worker   = TestWorker()
        for
          _ <- ZIO.attemptBlocking(worker.forked(ZIO.sleep(2.seconds), Some(permits)))
          _ <- ZIO.attemptBlocking(worker.forked(ZIO.unit, Some(permits), ZIO.succeed(unlocked.set(true))))
        yield assertTrue(unlocked.get)
      },
      test("a failing job gives its permit back") {
        val permits = JobPermits(maxJobs = 1)
        val worker  = TestWorker()
        for
          _ <- ZIO.attemptBlocking(worker.forked(ZIO.die(RuntimeException("bug")), Some(permits)))
          _ <- ZIO.succeed(permits.available).repeatUntil(_ == 1).timeout(5.seconds)
        yield assertTrue(permits.available == 1)
      }
    )
  ) @@ TestAspect.withLiveClock @@ TestAspect.timeout(60.seconds)
end WorkerExecutionSpec
