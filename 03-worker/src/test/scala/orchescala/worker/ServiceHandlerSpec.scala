package orchescala.worker

import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig, Slf4JLogger}
import orchescala.engine.rest.HttpClientProvider
import orchescala.worker.WorkerError.ServiceRequestError
import sttp.client3.*
import sttp.client3.testing.SttpBackendStub
import sttp.model.Method
import zio.*
import zio.test.*
import zio.test.Assertion.*

import scala.reflect.ClassTag

object ServiceHandlerSpec extends ZIOSpecDefault:

  given EngineRunContext = EngineRunContext(
    new EngineContext:
      override def engineConfig: EngineConfig = DefaultEngineConfig()
      override def workerConfig: WorkerConfig = DefaultWorkerConfig(engineConfig)
      override def getLogger(clazz: Class[?]): OrchescalaLogger = Slf4JLogger.logger("test")

      override def toEngineObject: Json => Any = ???

      override def sendRequest[ServiceIn: Encoder, ServiceOut: {Decoder, ClassTag}](
                                                                                     request: RunnableRequest[ServiceIn]
                                                                                   ): SendRequestType[ServiceOut] = ???
    ,
    GeneralVariables(_outputServiceMock = Some(MockedServiceResponse.success200(ServiceOut(true)).asJson))
  )

  case class In(id: Int = 1) derives InOutCodec
  given ApiSchema[In] = deriveApiSchema[In]
  case class Out(value: Boolean = false) derives InOutCodec
  given ApiSchema[Out] = deriveApiSchema[Out]
  case class ServiceIn(name: String = "test") derives InOutCodec
  case class ServiceOut(result: Boolean = false) derives InOutCodec

  val serviceTask = ServiceTask(
    InOutDescr("test", In(), Out()),
    MockedServiceResponse.success200(ServiceOut()),
    ServiceIn()
  )

  val handler = ServiceHandler[In, Out, ServiceIn, ServiceOut](
    httpMethod = Method.GET,
    apiUri = _ => uri"http://test.com/api",
    querySegments = _ => Seq.empty,
    inputMapper = _ => Some(ServiceIn()),
    inputHeaders = _ => Map.empty,
    outputMapper = (serviceResponse, _) => Right(Out(serviceResponse.outputBody.result)),
    defaultServiceOutMock = MockedServiceResponse.success200(ServiceOut(true)),
    serviceInExample = ServiceIn()
  )

  def spec = suite("ServiceHandlerSpec")(
    test("runWorkZIO should return mocked output when servicesMocked is true") {
      val input = In(1)
      
      val result = handler.runWorkZIO(input)
      
      assertZIO(result)(equalTo(Out(true)))
    },
    
    test("runWorkZIO should return mocked output when outputServiceMock is provided") {
      val input = In(1)
      val mockedResponse = MockedServiceResponse.success200(ServiceOut(true))
      val mockedJson = mockedResponse.asJson
      
      val result = handler.runWorkZIO(input)
      
      assertZIO(result)(equalTo(Out(true)))
    },
    
    test("runWorkZIO should handle error mocks correctly") {
      val input = In(1)
      val errorMock = MockedServiceResponse.error[ServiceOut](404)
      val mockedJson = errorMock.asJson
      given EngineRunContext = summon[EngineRunContext].copy(generalVariables = GeneralVariables(_outputServiceMock = Some(mockedJson)))
      val result = handler.runWorkZIO(input)
      
      assertZIO(result.exit)(fails(isSubtype[ServiceRequestError](anything)))
    }
  ).provideLayer(HttpClientProvider.live)

end ServiceHandlerSpec