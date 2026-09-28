package orchescala.worker

import com.github.blemale.scaffeine.Scaffeine
import zio.{Duration, durationInt}

/** A C7 / Operaton task whose IdentityCorrelation is not set yet (it follows the start of its
  * process within moments) is handed back with `unlock`: a waiting fetch of the client gets it
  * again at once. A failure (`handleFailure`) is picked up only at the client's next long polling -
  * up to its asyncResponseTimeout (15s), longer than a simulation waits for its next step.
  *
  * At most [[maxUnlocks]] times per task - then it fails like any error (retried, then an incident).
  */
object PendingIdentityRetries:

  val maxUnlocks: Int = 10
  val pause: Duration = 300.millis

  private val unlocks =
    Scaffeine().maximumSize(10_000).expireAfterWrite(scala.concurrent.duration.Duration(10, "minutes")).build[String, Int]()

  /** Counts the hand-back of the task - false once they are used up. */
  def unlockAgain(taskId: String): Boolean =
    val count = unlocks.getIfPresent(taskId).getOrElse(0) + 1
    unlocks.put(taskId, count)
    count <= maxUnlocks

end PendingIdentityRetries
