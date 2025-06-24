package orchescala
package worker

import orchescala.domain.*
import orchescala.worker.WorkerError.*
import zio.*

final class WorkRunner[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    T <: Worker[In, Out, ?]
](worker: T):

  def run(inputObject: In)(using
      EngineRunContext
  ): ZIO[SttpClientBackend, RunWorkError, Out | NoOutput] =
    worker.runWorkHandler
      .map:
        _.runWorkZIO(inputObject)
      .getOrElse:
        ZIO.succeed(NoOutput())

end WorkRunner
