package orchescala.engine.gateway

import orchescala.domain.*
import orchescala.engine.domain.*
import orchescala.engine.services.SignalService
import zio.test.*
import zio.{IO, ZIO}

object GSignalServiceTest extends ZIOSpecDefault:

  case class MockSignalService(
      engineTypeValue: EngineType,
      shouldFail: Boolean
  ) extends SignalService:
    val engineType: EngineType = engineTypeValue
    var signalCalls: List[String] = Nil

    override def sendSignal(
        name: String,
        tenantId: Option[String],
        withoutTenantId: Option[Boolean],
        variables: Option[JsonObject]
    ): IO[EngineError, Unit] =
      signalCalls = name :: signalCalls
      if shouldFail then ZIO.fail(EngineError.ProcessError(s"$engineType: connection refused"))
      else ZIO.unit
  end MockSignalService

  def spec = suite("GSignalService")(
    test("sendSignal broadcasts to all engines") {
      val c7Service = MockSignalService(EngineType.C7, shouldFail = false)
      val c8Service = MockSignalService(EngineType.C8, shouldFail = false)
      val gService  = GSignalService(using Seq(c7Service, c8Service))
      for
        _ <- gService.sendSignal("mySignal")
      yield assertTrue(
        c7Service.signalCalls == List("mySignal"),
        c8Service.signalCalls == List("mySignal")
      )
    },
    test("sendSignal succeeds when only some engines fail") {
      val c7Service = MockSignalService(EngineType.C7, shouldFail = false)
      val c8Service = MockSignalService(EngineType.C8, shouldFail = true)
      val gService  = GSignalService(using Seq(c7Service, c8Service))
      for
        exit <- gService.sendSignal("mySignal").exit
      yield assertTrue(
        exit.isSuccess,
        c7Service.signalCalls.length == 1,
        c8Service.signalCalls.length == 1
      )
    },
    test("sendSignal fails when all engines fail - naming all of them") {
      val c7Service = MockSignalService(EngineType.C7, shouldFail = true)
      val c8Service = MockSignalService(EngineType.C8, shouldFail = true)
      val gService  = GSignalService(using Seq(c7Service, c8Service))
      for
        error <- gService.sendSignal("mySignal").flip
      yield assertTrue(
        error.errorMsg.contains("C7: connection refused"),
        error.errorMsg.contains("C8: connection refused")
      )
    },
    test("sendSignal fails when no engine is configured") {
      val gService = GSignalService(using Seq.empty)
      for
        exit <- gService.sendSignal("mySignal").exit
      yield assertTrue(exit.isFailure)
    }
  )
end GSignalServiceTest
