package orchescala.worker

import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import sttp.client3.*
import sttp.client3.asynchttpclient.zio.AsyncHttpClientZioBackend
import sttp.model.{Method, StatusCode, Uri}
import zio.*
import zio.test.*

import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.duration as scalaDuration

object WorkerTimeoutSpec extends ZIOSpecDefault:

  /** A worker whose `timeout` is raised to 10 minutes - the one knob. */
  private object SlowWorker extends BaseWorker[NoInput, NoOutput]:
    def worker: Worker[NoInput, NoOutput, ?]                   = null
    override def timeout: scalaDuration.Duration               = scalaDuration.Duration(10, "minutes")
    def effectiveWorkerTimeout: Duration                       = workerTimeout
    def contextTimeout: Option[scalaDuration.FiniteDuration]   = workerTimeoutForContext

  private object DefaultWorker extends BaseWorker[NoInput, NoOutput]:
    def worker: Worker[NoInput, NoOutput, ?] = null
    def effective: Duration                  = workerTimeout

  private object ServiceClient extends RestApiClient

  def spec = suite("Worker timeout - one knob")(
    test("the default is 1 minute") {
      assertTrue(DefaultWorker.effective == 1.minute)
    },
    test("raising `timeout` raises how long the job may run and the service call timeout") {
      assertTrue(
        SlowWorker.effectiveWorkerTimeout == 10.minutes,
        SlowWorker.contextTimeout.contains(scalaDuration.Duration(10, "minutes"))
      )
    },
    test("a service call gets the worker's timeout - not the HTTP client's default of 1 minute") {
      val sent    = AtomicReference[Option[scalaDuration.Duration]](None)
      val backend = ZLayer.succeed[SttpClientBackend](
        AsyncHttpClientZioBackend.stub.whenAnyRequest.thenRespondF: request =>
          sent.set(Some(request.options.readTimeout))
          ZIO.succeed(Response("", StatusCode.Ok))
      )
      given EngineRunContext = EngineRunContext(
        DefaultEngineContext.example,
        GeneralVariables(),
        workerTimeout = SlowWorker.contextTimeout
      )
      val request = RunnableRequest[NoInput](
        Method.GET,
        Uri.unsafeParse("http://service/slow"),
        Seq.empty,
        None,
        Map.empty
      )
      for _ <- ServiceClient.sendRequest[NoInput, NoOutput](request).provideLayer(backend)
      yield assertTrue(sent.get.contains(scalaDuration.Duration(10, "minutes")))
    }
  )
end WorkerTimeoutSpec
