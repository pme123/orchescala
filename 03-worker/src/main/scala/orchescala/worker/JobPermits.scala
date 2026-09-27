package orchescala.worker

import java.util.concurrent.{Semaphore, TimeUnit}
import scala.concurrent.duration.*

/** Limits the jobs a worker client runs at once (C7/Op, see `BaseWorker.executeForked`).
  *
  * @param maxJobs
  *   jobs running at once - the `maxTasks` of the client
  * @param maxWait
  *   how long a fetched job may wait for a permit - well within its lock (`BaseWorker.lockTimeout`),
  *   which the job renews only once it runs
  */
final class JobPermits(val maxJobs: Int, val maxWait: FiniteDuration = 10.seconds):
  private val semaphore = Semaphore(maxJobs)

  def tryAcquire(): Boolean = semaphore.tryAcquire(maxWait.toMillis, TimeUnit.MILLISECONDS)
  def release(): Unit       = semaphore.release()
  def available: Int        = semaphore.availablePermits()
end JobPermits
