package orchescala.worker

import orchescala.domain.*
import orchescala.worker.WorkerError.{MockedOutput, ServiceError}
import zio.*
import zio.test.*
import zio.test.Assertion.*
import zio.test.TestAspect.*

import scala.reflect.ClassTag

object AstSpec extends ZIOSpecDefault:

  given EngineRunContext = EngineRunContext(
    new EngineContext:
      override def getLogger(clazz: Class[?]): OrchescalaLogger = ???

      override def toEngineObject: Json => Any =
        json => json.asBoolean.get

      override def sendRequest[ServiceIn: Encoder, ServiceOut: {Decoder, ClassTag}](
          request: RunnableRequest[ServiceIn]
      ): SendRequestType[ServiceOut] = ???
    ,
    GeneralVariables()
  )

  case class In(value: Int = 1)
  object In:
    given InOutCodec[In] = deriveInOutCodec[In]
    given ApiSchema[In]  = deriveApiSchema[In]

  case class Out(value: Boolean = true)
  object Out:
    given InOutCodec[Out] = deriveInOutCodec[Out]
    given ApiSchema[Out]  = deriveApiSchema[Out]

  def processName: String = "dummy"

  def spec = suite("AstSpec")(
    test("defaultMock Process") {
      val proc = Process(
        InOutDescr(
          processName,
          In(),
          Out()
        ),
        NoInput(),
        ProcessLabels.none
      ).mockWith: in =>
        if in.value == 1 then Out(true)
        else Out(false)

      val worker: InitWorker[In, Out, In] = InitWorker(
        inOutExample = proc,
        ValidationHandler(Right(_))
      )

      for
        result1 <- worker.defaultMock(In(1))
        result2 <- worker.defaultMock(In(3))
      yield assertTrue(
        result1 == Out(),
        result2 == Out(false)
      )
      end for
    },
    test("defaultMock ServiceTask") {
      val servTask = ServiceTask[In, Out, NoInput, Out](
        inOutDescr = InOutDescr[In, Out](
          id = "test",
          in = In(),
          out = Out()
        ),
        defaultServiceOutMock = MockedServiceResponse.success200(Out()),
        serviceInExample = NoInput()
      ).mockWith: in =>
        MockedServiceResponse.success200(Out(
          if in.value == 1 then true else false
        ))

      val worker = ServiceWorker(
        inOutExample = servTask,
        validationHandler = ValidationHandler(Right(_)),
        runWorkHandler = Some(
          ServiceHandler[In, Out, NoInput, Out](
            httpMethod = Method.GET,
            apiUri = _ => Uri("http://localhost:8080"),
            querySegments = _ => Seq.empty,
            inputMapper = _ => None,
            inputHeaders = _ => Map.empty,
            defaultServiceOutMock = servTask.defaultServiceOutMock,
            outputMapper = (serviceOut, _) => Right(Out(serviceOut.outputBody.value)),
            serviceInExample = NoInput(),
            dynamicServiceOutMock = servTask.dynamicServiceOutMock
          )
        )
      )

      for
        result1 <- worker.defaultMock(In(1))
        result2 <- worker.defaultMock(In(3))
      yield assertTrue(
        result1 == Out(),
        result2 == Out(false)
      )
      end for
    }
  )

end AstSpec
