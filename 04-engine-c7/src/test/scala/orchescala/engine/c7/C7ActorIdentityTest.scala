package orchescala.engine.c7

import com.sun.net.httpserver.HttpServer
import io.circe.{Json, JsonObject, parser}
import orchescala.domain.{IdentityCorrelation, IdentityCorrelationSigner}
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.*
import zio.test.*

import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

/** Completing a user task / sending a message passes the actor's identity as
  * `_identityCorrelationOfActor` - `_identityCorrelation` stays as set at the start (only the
  * deprecated `doOverrideImpersonation = true` still overwrites it).
  */
object C7ActorIdentityTest extends ZIOSpecDefault:

  private val signingKey = "test-signing-key"
  private val actor      = IdentityCorrelation("bob", Some("bob@example.com"))

  /** C7 stub: the task belongs to `pi-1`, its form variables are `formVariables`; records the
    * request bodies by path.
    */
  private def engine(formVariables: String)
      : ZIO[Scope, Throwable, (String, ConcurrentLinkedQueue[(String, String)])] =
    ZIO.acquireRelease(
      ZIO.attempt:
        val requests = ConcurrentLinkedQueue[(String, String)]()
        val server   = HttpServer.create(InetSocketAddress("localhost", 0), 0)
        server.createContext(
          "/",
          exchange =>
            val path = exchange.getRequestURI.getPath
            requests.add(path -> String(exchange.getRequestBody.readAllBytes(), StandardCharsets.UTF_8))
            val answer =
              if path.endsWith("/form-variables") then formVariables
              else if path.startsWith("/task/") && !path.endsWith("/complete") then
                """{"id":"t-1","processInstanceId":"pi-1"}"""
              else if path.startsWith("/message") then
                """[{"resultType":"Execution","execution":{"id":"ex-1","processInstanceId":"pi-1"}}]"""
              else ""
            if answer.isEmpty then exchange.sendResponseHeaders(204, -1)
            else
              val body = answer.getBytes(StandardCharsets.UTF_8)
              exchange.getResponseHeaders.add("Content-Type", "application/json")
              exchange.sendResponseHeaders(200, body.length)
              exchange.getResponseBody.write(body)
            exchange.close()
        )
        server.start()
        (server, requests)
    )((server, _) => ZIO.succeed(server.stop(0)))
      .map((server, requests) => (s"http://localhost:${server.getAddress.getPort}", requests))

  private def apiClient(baseUrl: String): IO[EngineError, ApiClient] = ZIO.succeed:
    val client = ApiClient(ApiHttpClient.pooled())
    client.setBasePath(baseUrl)
    client

  /** The variables of the request to the path (ending with `pathEnd`). */
  private def variablesOf(
      requests: ConcurrentLinkedQueue[(String, String)],
      pathEnd: String,
      field: String
  ) =
    requests.asScala.collectFirst { case (p, b) if p.endsWith(pathEnd) => b }
      .flatMap(parser.parse(_).toOption)
      .get.hcursor.downField(field)

  /** A Json variable: its value is the serialized object. */
  private def correlationIn(variables: io.circe.ACursor, name: String): Option[IdentityCorrelation] =
    variables.downField(name).downField("value").focus
      .flatMap(v => v.asString.flatMap(parser.parse(_).toOption).orElse(Some(v)))
      .flatMap(_.as[IdentityCorrelation].toOption)

  private def signedFor(pid: String)(c: IdentityCorrelation) =
    c.processInstanceId.contains(pid) &&
      IdentityCorrelationSigner.verify(c, pid, c.signature.get, signingKey)

  private def complete(formVariables: String, in: JsonObject = JsonObject.empty) =
    for
      (baseUrl, requests) <- engine(formVariables)
      given IO[EngineError, ApiClient] = apiClient(baseUrl)
      given EngineConfig               = DefaultEngineConfig(identitySigningKey = Some(signingKey))
      _                   <- C7UserTaskService().complete("t-1", in, Some(actor))
    yield variablesOf(requests, "/complete", "variables")

  def spec = suite("C7 identity of the actor")(
    test("completing a user task adds the signed actor - _identityCorrelation untouched") {
      for variables <- complete("{}")
      yield
        val signed = correlationIn(variables, "_identityCorrelationOfActor")
        assertTrue(
          signed.map(_.username).contains("bob"),
          signed.exists(signedFor("pi-1")),
          variables.downField("_identityCorrelation").failed
        )
    },
    test("a caller supplied _identityCorrelationOfActor is replaced by the signed one") {
      val forged = JsonObject(
        "_identityCorrelationOfActor" -> Json.obj("username" -> Json.fromString("mallory")),
        "_identityCorrelation"        -> Json.obj("username" -> Json.fromString("mallory"))
      )
      for variables <- complete("{}", forged)
      yield assertTrue(
        correlationIn(variables, "_identityCorrelationOfActor").map(_.username).contains("bob"),
        variables.downField("_identityCorrelation").failed
      )
    },
    test("doOverrideImpersonation = false keeps _identityCorrelation") {
      for variables <- complete("""{"doOverrideImpersonation":{"value":false,"type":"Boolean"}}""")
      yield assertTrue(
        correlationIn(variables, "_identityCorrelationOfActor").exists(signedFor("pi-1")),
        variables.downField("_identityCorrelation").failed
      )
    },
    test("deprecated doOverrideImpersonation = true also overwrites _identityCorrelation") {
      for variables <- complete("""{"doOverrideImpersonation":{"value":true,"type":"Boolean"}}""")
      yield
        val overridden = correlationIn(variables, "_identityCorrelation")
        assertTrue(
          overridden.map(_.username).contains("bob"),
          overridden.exists(signedFor("pi-1")),
          correlationIn(variables, "_identityCorrelationOfActor").exists(signedFor("pi-1"))
        )
    },
    test("a message to a process instance carries the signed sender") {
      for
        (baseUrl, requests) <- engine("{}")
        given IO[EngineError, ApiClient] = apiClient(baseUrl)
        given EngineConfig               = DefaultEngineConfig(identitySigningKey = Some(signingKey))
        _                   <- C7MessageService().sendMessage(
                                 "reset",
                                 processInstanceId = Some("pi-1"),
                                 identityCorrelation = Some(actor)
                               )
      yield
        val variables = variablesOf(requests, "/message", "processVariables")
        assertTrue(
          correlationIn(variables, "_identityCorrelationOfActor").exists(signedFor("pi-1")),
          variables.downField("_identityCorrelation").failed
        )
    },
    test("a message by businessKey goes without the sender - the instance is not known yet") {
      for
        (baseUrl, requests) <- engine("{}")
        given IO[EngineError, ApiClient] = apiClient(baseUrl)
        given EngineConfig               = DefaultEngineConfig(identitySigningKey = Some(signingKey))
        _                   <- C7MessageService().sendMessage(
                                 "reset",
                                 businessKey = Some("bk-1"),
                                 variables = Some(JsonObject("amount" -> Json.fromInt(1))),
                                 identityCorrelation = Some(actor)
                               )
      yield
        val variables = variablesOf(requests, "/message", "processVariables")
        assertTrue(
          variables.downField("amount").succeeded,
          variables.downField("_identityCorrelationOfActor").failed
        )
    }
  )
end C7ActorIdentityTest
