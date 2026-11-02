package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import orchescala.domain.IdentityCorrelation
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.jdk.CollectionConverters.*

object C7StartByMessageTest extends ZIOSpecDefault:

  private val correlatedToRunning =
    """[{"resultType":"Execution","execution":{"id":"ex-1","processInstanceId":"running-pi"}}]"""
  private val started             =
    """[{"resultType":"ProcessDefinition","processInstance":{"id":"new-pi"}}]"""

  private val noCorrelation   = 200 -> """{"_identityCorrelationPending":{"type":"Boolean","value":true}}"""
  private val withCorrelation =
    200 -> """{"_identityCorrelationPending":{"type":"Boolean","value":true},"_identityCorrelation":{"type":"Json","value":"{}"}}"""
  private val checkFails      = 500 -> """{"type":"RestException","message":"boom"}"""
  // how C7 answers the variables of an instance that has ended
  private val instanceEnded   =
    500 -> """{"type":"NullValueException","message":"Cannot get process instance variables running-pi: execution running-pi doesn't exist: execution is null"}"""
  private val notFound        = 404 -> """{"type":"InvalidRequestException","message":"Process instance running-pi not found"}"""

  /** C7 stub: /message answers `messageResult`, the n-th variables GET `variableChecks(n)` (the last
    * one repeats), a variables POST `patch`. Records the requests (method, path, body).
    */
  private def engine(
      messageResult: String,
      variableChecks: Seq[(Int, String)] = Seq(noCorrelation),
      patch: (Int, String) = 204 -> ""
  ): ZIO[Scope, Throwable, (String, ConcurrentLinkedQueue[String])] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val requests = ConcurrentLinkedQueue[String]()
        val checks   = AtomicInteger(0)
        val server   = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/",
          exchange =>
            val method      = exchange.getRequestMethod
            val path        = exchange.getRequestURI.getPath
            val requestBody = String(exchange.getRequestBody.readAllBytes(), StandardCharsets.UTF_8)
            requests.add(s"$method $path $requestBody")
            val (status, body) =
              if path.endsWith("/message") then 200 -> messageResult
              else if method == "GET" && path.endsWith("/variables") then
                variableChecks(math.min(checks.getAndIncrement(), variableChecks.size - 1))
              else if path.endsWith("/variables") then patch
              else 204                                              -> ""
            val bytes = body.getBytes(StandardCharsets.UTF_8)
            exchange.getResponseHeaders.add("Content-Type", "application/json")
            if bytes.isEmpty then exchange.sendResponseHeaders(status, -1)
            else
              exchange.sendResponseHeaders(status, bytes.length)
              exchange.getResponseBody.write(bytes)
            exchange.close()
        )
        server.start()
        (server, requests)
    )((server, _) => ZIO.succeed(server.stop(0)))
      .map((server, requests) => (s"http://localhost:${server.getAddress.getPort}", requests))

  private val fastTimings =
    C7ProcessInstanceService.StartTimings(correlationChecks = 3, correlationCheckInterval = 1.milli)

  private def service(baseUrl: String) =
    given IO[EngineError, ApiClient] = ZIO.succeed:
      val client = ApiClient(ApiHttpClient.pooled())
      client.setBasePath(baseUrl)
      client
    given EngineConfig = DefaultEngineConfig(identitySigningKey = Some("secret"))
    C7ProcessInstanceService(fastTimings)

  private val alice = Some(IdentityCorrelation("alice"))

  private def conflict(exit: Exit[EngineError, ?])(check: String => Boolean) =
    exit.causeOption.flatMap(_.failureOption).exists:
      case EngineError.ServiceRequestError(409, msg) => check(msg)
      case _                                         => false

  private def runningChecks(requests: ConcurrentLinkedQueue[String]) =
    requests.asScala.count(_.startsWith("GET /process-instance/running-pi/variables"))

  private def markerRemoved(requests: ConcurrentLinkedQueue[String]) =
    requests.asScala.exists(r =>
      r.startsWith("POST /process-instance/running-pi/variables") && r.contains("_identityCorrelationPending")
    )

  private val noNote: String => Boolean = msg => msg.contains("running-pi") && !msg.contains("could not be removed")

  def spec = suite("C7 start process by message")(
    test("a message correlated to a running instance is no start - and gets no identity") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning)
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(noNote),
        // the caller's identity was signed onto the running instance
        !requests.asScala.exists(r =>
          r.contains("/process-instance/running-pi/variables") && r.contains("\"_identityCorrelation\"")
        ),
        // no correlation shows up: the pending marker, delivered with the message, is removed again
        runningChecks(requests) == fastTimings.correlationChecks,
        markerRemoved(requests)
      )
    },
    test("the running instance's own start sets its correlation meanwhile - the marker stays") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning, Seq(noCorrelation, withCorrelation))
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(noNote),
        runningChecks(requests) == 2,
        !markerRemoved(requests)
      )
    },
    test("the correlation shows up at the last check - the marker stays") {
      val lastCheck = Seq.fill(fastTimings.correlationChecks - 1)(noCorrelation) :+ withCorrelation
      for
        (baseUrl, requests) <- engine(correlatedToRunning, lastCheck)
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(noNote),
        runningChecks(requests) == fastTimings.correlationChecks,
        !markerRemoved(requests)
      )
    },
    test("the running instance has ended - nothing to remove, a plain 409") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning, Seq(instanceEnded))
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(noNote),
        runningChecks(requests) == 1,
        !markerRemoved(requests)
      )
    },
    test("the running instance is not found (404) - nothing to remove, a plain 409") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning, Seq(notFound))
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(noNote),
        runningChecks(requests) == 1,
        !markerRemoved(requests)
      )
    },
    test("the running instance ends before its marker is removed - a plain 409") {
      for
        (baseUrl, requests) <- engine(
                                 correlatedToRunning,
                                 patch = 500 -> """{"type":"ProcessEngineException","message":"Cannot modify variables for process instance running-pi: execution running-pi doesn't exist: execution is null"}"""
                               )
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(noNote),
        markerRemoved(requests)
      )
    },
    test("the correlation check fails - nothing is removed, the 409 says so") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning, Seq(checkFails))
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(msg => msg.contains("running-pi") && msg.contains("could not be removed")),
        runningChecks(requests) == 1,
        !markerRemoved(requests)
      )
    },
    test("removing the marker fails - the 409 says so") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning, patch = 500 -> """{"type":"RestException","message":"boom"}""")
        exit                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice).exit
      yield assertTrue(
        conflict(exit)(msg => msg.contains("running-pi") && msg.contains("could not be removed")),
        markerRemoved(requests)
      )
    },
    test("without identity there is no marker - nothing is checked") {
      for
        (baseUrl, requests) <- engine(correlatedToRunning)
        exit                <- service(baseUrl).startProcessByMessage("msg").exit
      yield assertTrue(
        conflict(exit)(_.contains("running-pi")),
        runningChecks(requests) == 0,
        !markerRemoved(requests)
      )
    },
    test("a started process gets the signed identity") {
      for
        (baseUrl, requests) <- engine(started)
        info                <- service(baseUrl).startProcessByMessage("msg", identityCorrelation = alice)
      yield assertTrue(
        info.processInstanceId == "new-pi",
        requests.asScala.exists(_.contains("/process-instance/new-pi/variables")),
        runningChecks(requests) == 0
      )
    }
  ) @@ TestAspect.withLiveClock
end C7StartByMessageTest
