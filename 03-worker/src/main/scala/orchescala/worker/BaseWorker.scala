package orchescala.worker

import io.circe.Decoder.Result
import orchescala.domain.*
import orchescala.engine.{EngineConfig, EngineRuntime}
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
import orchescala.worker.*
import orchescala.worker.WorkerError.{BadVariableError, ValidatorError}
import zio.*

trait BaseWorker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends WorkerDsl[In, Out]:

  /** Maximum time a job of this worker may run - [[timeout]]: override that one, the dependent
    * timeouts follow it (lock renewal, service calls).
    */
  protected def workerTimeout: Duration = Duration.fromScala(timeout)

  /** [[workerTimeout]] for the [[EngineRunContext]] - the service calls may take as long. */
  protected def workerTimeoutForContext: Option[scala.concurrent.duration.FiniteDuration] =
    Some(scala.concurrent.duration.FiniteDuration(workerTimeout.toMillis, "ms"))

  /** How long the engine keeps a job for this worker (C7/Op lock, C8 job timeout). Short, so the job
    * of a crashed worker app is handed out again after at most this time - a running job renews it
    * every [[lockRenewInterval]] (up to [[workerTimeout]]), so it is never handed out twice.
    */
  private[worker] def lockTimeout: Duration = 1.minute

  /** How often a running job renews its lock - well within [[lockTimeout]]. */
  private[worker] def lockRenewInterval: Duration = lockTimeout.dividedBy(2)

  // a job whose lock runs out within this margin is not started (the engine hands it out again)
  private[worker] def lockExpiryMargin: Duration = 5.seconds

  /** The job as one effect.
    *
    *   - skipped, if its lock already (almost) ran out while it waited for a thread / permit - the
    *     engine hands it out again, running it too would run it twice
    *   - `renewLock` while it runs: when the remaining lock drops below [[lockRenewInterval]], then
    *     every [[lockRenewInterval]] (fast jobs never renew)
    *   - interrupted after [[workerTimeout]], then `onTimeout` (the engine must learn that it failed)
    *   - an error or a defect (an exception of the worker's code) that escaped the execution:
    *     logged with its cause, then `onFailure` - it was only logged (or not even that), the job
    *     was neither completed nor failed: fetched again after its lock ran out, without end and
    *     without counting down the retries
    *   - all with the logger and HTTP layers
    */
  private def jobEffect[T](
      jobId: String,
      execution: ZIO[SttpClientBackend, Throwable, T],
      onTimeout: UIO[Unit],
      onFailure: Throwable => UIO[Unit],
      renewLock: UIO[Unit],
      lockExpiresAt: Option[Long]
  ): UIO[Unit] =
    // only when needed: once the remaining lock drops below lockRenewInterval (a fresh lock: after
    // lockRenewInterval) - most jobs are done before and never renew. Renewing at once raced the
    // completion of fast jobs ("Entity was updated by another transaction concurrently" in C7).
    val renewing =
      Clock.currentTime(java.util.concurrent.TimeUnit.MILLISECONDS).flatMap: now =>
        val firstRenewal = lockExpiresAt
          .fold(lockRenewInterval.toMillis)(expires => (expires - now - lockRenewInterval.toMillis).max(0L))
        ZIO.sleep(Duration.fromMillis(firstRenewal)) *>
          (renewLock *> ZIO.sleep(lockRenewInterval)).forever
    // forked in the job's scope: interrupted when the job ends (or times out). Not forked in an
    // acquire - that region is uninterruptible, its fibers too, and the interrupt would wait forever
    val job      =
      ZIO.scoped(renewing.forkScoped *> execution.unit)
        // an error's details (bodies, variables) go into the incident - not into the log
        .catchAll: error =>
          ZIO.logError(
            s"Worker execution for job $jobId failed - reported as failed: ${orchescala.engine.LogSafe.forLog(error.toString)}"
          ) *> onFailure(error)
        .catchAllDefect: defect =>
          ZIO.logErrorCause(s"Worker execution for job $jobId died - reported as failed", Cause.die(defect)) *>
            onFailure(defect)
        .timeout(workerTimeout)
        .flatMap:
          case Some(_) =>
            ZIO.logDebug(s"Worker execution for job $jobId completed successfully")
          case None    =>
            ZIO.logError(
              s"Worker execution for job $jobId timed out after $workerTimeout - reported as failed"
            ) *> onTimeout
    Clock.currentTime(java.util.concurrent.TimeUnit.MILLISECONDS)
      .flatMap: now =>
        if lockExpiresAt.exists(_ - now < lockExpiryMargin.toMillis) then
          ZIO.logWarning(
            s"Lock of job $jobId ran out before it started (waited too long for a thread / permit) - left to the engine"
          )
        else job
      .provideLayer(EngineRuntime.sharedExecutorLayer ++ HttpClientProvider.live)
      .catchAllCause: cause =>
        ZIO.logErrorCause(s"Worker execution for job $jobId failed", cause)
      // also the timeout / error logs go through SLF4J (before: ZIO's console logger)
      .provideLayer(EngineRuntime.logger)
  end jobEffect

  /** Runs the job on the calling thread and returns when it is done - for the C8 client: it runs
    * the handlers on its job threads and counts a job as active until the handler returns, so
    * `maxJobsActive` limits the jobs in flight. (Returning at once let it fetch more and more jobs,
    * and a job still running past its job timeout was handed out again.) Errors and defects go to
    * `onFailure` - nothing is thrown: the C8 client only catches an `Exception`, and ZIO's
    * `FiberFailure` is none (the job stayed activated until its timeout, again and again).
    */
  protected def executeBlocking[T](jobId: String)(
      execution: ZIO[SttpClientBackend, Throwable, T],
      onTimeout: UIO[Unit] = ZIO.unit,
      onFailure: Throwable => UIO[Unit] = _ => ZIO.unit,
      renewLock: UIO[Unit] = ZIO.unit,
      lockExpiresAt: Option[Long] = None
  ): Unit =
    Unsafe.unsafe:
      implicit unsafe =>
        EngineRuntime.zioRuntime.unsafe
          .run(jobEffect(jobId, execution, onTimeout, onFailure, renewLock, lockExpiresAt)) match
          case Exit.Success(_)     => ()
          // only if the job effect itself died (e.g. in onFailure) - an Exception, see above
          case Exit.Failure(cause) =>
            throw RuntimeException(s"Job $jobId failed: ${cause.prettyPrint}", cause.squashTrace)

  /** Runs the job in the background - for the C7/Op external task client, whose single thread
    * calls the handlers one after the other (running them there would process one job at a time).
    * With `permits`, the handler first waits for a permit, so at most `JobPermits.maxJobs` run at
    * once and the client fetches no new jobs meanwhile; without one after `JobPermits.maxWait`,
    * `onNoPermit` (return the job to the engine, before its lock runs out).
    */
  protected def executeForked[T](jobId: String)(
      execution: ZIO[SttpClientBackend, Throwable, T],
      onTimeout: UIO[Unit] = ZIO.unit,
      onFailure: Throwable => UIO[Unit] = _ => ZIO.unit,
      permits: Option[JobPermits] = None,
      onNoPermit: UIO[Unit] = ZIO.unit,
      renewLock: UIO[Unit] = ZIO.unit,
      lockExpiresAt: Option[Long] = None
  ): Unit =
    Unsafe.unsafe:
      implicit unsafe =>
        if permits.exists(!_.tryAcquire()) then
          EngineRuntime.zioRuntime.unsafe.run(
            (ZIO.logWarning(
              s"No free worker slot for job $jobId within ${permits.get.maxWait} - returned to the engine"
            ) *> onNoPermit).provideLayer(EngineRuntime.logger)
          )
          ()
        else
          EngineRuntime.zioRuntime.unsafe.fork:
            jobEffect(jobId, execution, onTimeout, onFailure, renewLock, lockExpiresAt)
              .ensuring(ZIO.succeed(permits.foreach(_.release())))
          ()
  end executeForked

  /** Former name of [[executeForked]] without permits. */
  protected def executeWithScope[T](jobId: String)(
      execution: ZIO[SttpClientBackend, Throwable, T]
  ): Unit =
    executeForked(jobId)(execution)

  protected def extractBusinessKey(json: Json) =
    ZIO.fromEither(json.as[BusinessKey].map(_.businessKey.getOrElse("no businessKey")))
      .mapError(ex =>
        ValidatorError(
          s"Problem extract business Key from ${orchescala.engine.LogSafe.names(json)}\n" + ex.getMessage
        )
      )

  protected def processVariable(
      key: String,
      json: Json
  ): IO[BadVariableError, (String, Option[Json])] =
    json.hcursor.downField(key).as[Option[Json]] match
      case Right(value) =>
        ZIO.succeed(key -> value)
      case Left(ex)     =>
        ZIO.fail(BadVariableError(ex.getMessage))

  protected def isErrorHandled(error: WorkerError, handledErrors: Seq[String]): Boolean =
    error.isMock || // if it is mocked, it is handled in the error, as it also could be a successful output
      handledErrors.contains(error.errorCode.toString) || // if the error code is in the handled errors
      handledErrors.contains(error.causeError.map(_.errorCode.toString).getOrElse("NOT-HANDLED")) || // if the cause error code is in the handled errors
      handledErrors.map(  // if there is a catchall
        _.toLowerCase
      ).contains("catchall")

  case class BusinessKey(businessKey: Option[String])

  object BusinessKey:
    given InOutCodec[BusinessKey] = deriveInOutCodec

end BaseWorker
