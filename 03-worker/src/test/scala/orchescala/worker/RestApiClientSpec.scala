package orchescala.worker

import orchescala.domain.*
import orchescala.worker.OrchescalaWorkerError.*
import zio.test.*
import zio.test.Assertion.*
import zio.test.TestAspect.*

object RestApiClientSpec extends ZIOSpecDefault with RestApiClient:

  type ServiceOut = NoOutput

  case class MyClass(value: Int = 12)
  object MyClass:
    given InOutCodec[MyClass] = deriveInOutCodec

  def spec = suite("RestApiClientTest")(
    test("NoOutput") {
      assertZIO(decodeResponse[ServiceOut](""))(
        equalTo(NoOutput())
      )
    },

    test("NoOutput OK") {
      assertZIO(decodeResponse[ServiceOut]("OK"))(
        equalTo(NoOutput())
      )
    },

    test("Seq OK") {
      assertZIO(decodeResponse[Seq[String]]("[\"hello\"]"))(
        equalTo(Seq("hello"))
      )
    },

    test("Bad body OK") {
      assertZIO(decodeResponse[MyClass]("OK").flip)(
        equalTo(
            ServiceBadBodyError(
              errorMsg =
                """Problem creating body from response.
                  |NonEmptyList(ParsingFailure: expected json value got 'OK' (line 1, column 1))
                  |BODY: OK""".stripMargin
            )
          )

      )
    },

    test("no NoOutput") {
      assertZIO(decodeResponse[String]("").flip)(
        equalTo(
          ServiceBadBodyError(
            "There is no body in the response and the ServiceOut is neither NoOutput nor Option (Class is class java.lang.String)."
          )
        )
      )
    },

    test("with Output") {
      assertZIO(decodeResponse[MyClass]("{ \"value\": 12}"))(
        equalTo(MyClass())
      )
    },

    test("with optional Output") {
      assertZIO(decodeResponse[Option[MyClass]](""))(
        equalTo(None)
      )
    },

    test("hasNoOutput") {
      assertTrue(hasNoOutput[NoOutput]())
    },

    test("hasNoOutput false") {
      assertTrue(!(hasNoOutput[String]()))
    }
  ) @@ sequential

end RestApiClientSpec