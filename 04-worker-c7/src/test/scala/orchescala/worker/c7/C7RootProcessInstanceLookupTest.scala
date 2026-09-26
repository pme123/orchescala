package orchescala.worker.c7

import com.sun.net.httpserver.HttpServer
import munit.FunSuite
import org.camunda.bpm.client.ExternalTaskClient
import zio.{Runtime, Unsafe, ZIO}

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger

class C7RootProcessInstanceLookupTest extends FunSuite:

  private def run[A](effect: ZIO[Any, String, A]): Either[String, A] =
    Unsafe.unsafe(implicit unsafe => Runtime.default.unsafe.run(effect.either).getOrThrowFiberFailure())

  test("looks the root up in the history once per process instance, with the client's auth"):
    val requests  = AtomicInteger(0)
    var authSeen  = Option.empty[String]
    val server    = HttpServer.create(InetSocketAddress("localhost", 0), 0)
    server.createContext(
      "/engine-rest/history/process-instance/child-1",
      exchange =>
        requests.incrementAndGet()
        authSeen = Option(exchange.getRequestHeaders.getFirst("Authorization"))
        val body = """{"id":"child-1","rootProcessInstanceId":"root-1"}""".getBytes(StandardCharsets.UTF_8)
        exchange.getResponseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(200, body.length)
        exchange.getResponseBody.write(body)
        exchange.close()
    )
    server.start()
    try
      val workerClient = new C7WorkerClient:
        protected def camundaRestUrl: String =
          s"http://localhost:${server.getAddress.getPort}/engine-rest"
        override protected def engineAuthorization: Option[String] = Some("Bearer tech-user")
        def client: ZIO[SharedC7ExternalClientManager, Throwable, ExternalTaskClient] = ???
      assertEquals(run(workerClient.rootProcessInstanceId("child-1")), Right(Some("root-1")))
      assertEquals(run(workerClient.rootProcessInstanceId("child-1")), Right(Some("root-1")))
      assertEquals(requests.get, 1) // cached - a root never changes
      assertEquals(authSeen, Some("Bearer tech-user"))
    finally server.stop(0)

end C7RootProcessInstanceLookupTest
