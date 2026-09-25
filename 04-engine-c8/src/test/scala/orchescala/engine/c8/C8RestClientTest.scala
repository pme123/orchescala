package orchescala.engine.c8

import io.circe.{Json, parser}
import orchescala.engine.{AuthContext, DefaultEngineConfig}
import orchescala.engine.domain.*
import orchescala.engine.rest.SttpClientBackend
import sttp.client3.*
import sttp.client3.asynchttpclient.zio.AsyncHttpClientZioBackend
import sttp.model.{Part, StatusCode}
import zio.*
import zio.test.*

import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

object C8RestClientTest extends ZIOSpecDefault:

  private val restAddress = "http://camunda:8080"

  /** A stub cluster: answers with `respond` and records every request. */
  private final class StubCluster(respond: Request[?, ?] => (Int, String)):
    val requests = ConcurrentLinkedQueue[Request[?, ?]]()

    val backend: SttpClientBackend =
      AsyncHttpClientZioBackend.stub
        .whenAnyRequest
        .thenRespondF: request =>
          requests.add(request)
          val (status, body) = respond(request)
          ZIO.succeed(Response(body, StatusCode(status)))

    def client(auth: C8RestAuth = C8RestAuth.PassThrough): C8RestClient =
      C8RestClient(restAddress, auth, backend, retryBase = 1.millis)

    def all: Seq[Request[?, ?]] = requests.asScala.toSeq
    def paths: Seq[String]      = all.map(_.uri.path.mkString("/"))
    def authHeaders: Seq[Option[String]] = all.map(_.header("Authorization"))
    def jsonBodies: Seq[Json]   = all.map(bodyJson)
  end StubCluster

  private def bodyJson(request: Request[?, ?]): Json =
    request.body match
      case StringBody(s, _, _) => parser.parse(s).toOption.get
      case other               => Json.fromString(other.toString)

  private val emptySearch = """{"items":[],"page":{"totalItems":0}}"""

  def spec = suite("C8RestClient")(
    suite("authentication")(
      test("passes the caller's token through - per request, no client per token") {
        val cluster = StubCluster(_ => 200 -> emptySearch)
        val rest    = cluster.client()
        for
          _ <- AuthContext.withBearerToken("token-a")(rest.post[Json](Seq("x"), Json.obj()))
          _ <- AuthContext.withBearerToken("token-b")(rest.post[Json](Seq("x"), Json.obj()))
          _ <- rest.post[Json](Seq("x"), Json.obj())
        yield assertTrue(
          cluster.authHeaders == Seq(Some("Bearer token-a"), Some("Bearer token-b"), None)
        )
      },
      test("concurrent callers never get each other's token") {
        val cluster = StubCluster: request =>
          200 -> Json.obj("auth" -> Json.fromString(request.header("Authorization").get)).noSpaces
        val rest    = cluster.client()
        for
          answers <- ZIO.foreachPar((1 to 50).toList): i =>
                       AuthContext.withBearerToken(s"token-$i"):
                         rest.post[Json](Seq("x"), Json.obj()).map(i -> _)
        yield assertTrue(answers.forall: (i, json) =>
          json.hcursor.get[String]("auth").contains(s"Bearer token-$i"))
      },
      test("client credentials: fetches the token once, refetches after a 401") {
        var cluster: StubCluster = null
        var tokenCalls           = 0
        var rejectedOnce         = false
        cluster = StubCluster: request =>
          request.uri.path.mkString("/") match
            case "oauth/token" =>
              tokenCalls += 1
              200 -> s"""{"access_token":"cc-$tokenCalls","expires_in":3600}"""
            case _ if !rejectedOnce && cluster.all.count(_.uri.path.last == "x") == 3 =>
              rejectedOnce = true
              401 -> """{"title":"UNAUTHORIZED","detail":"token revoked"}"""
            case _             => 200 -> "{}"
        val auth = C8RestAuth.ClientCredentials("http://sso/oauth/token", "id", "secret", "aud", cluster.backend)
        val rest = cluster.client(auth)
        for
          _ <- rest.post[Json](Seq("x"), Json.obj())
          _ <- rest.post[Json](Seq("x"), Json.obj())
          _ <- rest.post[Json](Seq("x"), Json.obj()) // 401 -> new token -> retried
        yield assertTrue(
          tokenCalls == 2,
          cluster.all.filter(_.uri.path.last == "x").map(_.header("Authorization").get) ==
            Seq("Bearer cc-1", "Bearer cc-1", "Bearer cc-1", "Bearer cc-2")
        )
      },
      test("pass-through: a 401 is not retried and keeps its status") {
        val cluster = StubCluster(_ => 401 -> """{"title":"UNAUTHORIZED","detail":"expired"}""")
        for exit <- AuthContext.withBearerToken("old")(cluster.client().get[Json](Seq("x"))).exit
        yield assertTrue(
          cluster.all.size == 1,
          exit match
            case Exit.Failure(cause) =>
              cause.failureOption.exists:
                case EngineError.ServiceRequestError(401, msg) => msg.contains("expired")
                case _                                         => false
            case _                   => false
        )
      }
    ),
    suite("robustness")(
      test("retries backpressure (429 / 503) and then succeeds") {
        var calls   = 0
        val cluster = StubCluster: _ =>
          calls += 1
          if calls <= 2 then (if calls == 1 then 429 else 503) -> "{}"
          else 200 -> """{"ok":true}"""
        for json <- cluster.client().post[Json](Seq("x"), Json.obj())
        yield assertTrue(calls == 3, json.hcursor.get[Boolean]("ok").contains(true))
      },
      test("maps a problem detail to a ServiceRequestError with the cluster's status") {
        val cluster = StubCluster(_ =>
          404 -> """{"type":"about:blank","title":"NOT_FOUND","status":404,"detail":"Process instance with key '1' not found"}"""
        )
        for exit <- cluster.client().get[Json](Seq("process-instances", "1")).exit
        yield assertTrue(
          cluster.all.size == 1, // not retried
          exit.causeOption.flatMap(_.failureOption).exists:
            case EngineError.ServiceRequestError(404, msg) =>
              msg.contains("NOT_FOUND") && msg.contains("not found")
            case _                                         => false
        )
      },
      test("searchAll follows the cursor instead of returning only the first page") {
        val cluster = StubCluster: request =>
          bodyJson(request).hcursor.downField("page").get[String]("after").toOption match
            case None           => 200 -> """{"items":[{"n":1},{"n":2}],"page":{"endCursor":"c1"}}"""
            case Some("c1")     => 200 -> """{"items":[{"n":3}],"page":{"endCursor":"c2"}}"""
            case Some(other)    => 500 -> s"unexpected cursor $other"
        for items <- cluster.client().searchAll[Json](Seq("x", "search"), Json.obj(), pageSize = 2)
        yield assertTrue(items.flatMap(_.hcursor.get[Int]("n").toOption) == Seq(1, 2, 3))
      }
    ),
    suite("services")(
      test("variables: root scope, names filtered server-side, untruncated values") {
        val cluster = StubCluster(_ =>
          200 -> """{"items":[
                   |  {"variableKey":"11","name":"a","value":"{\"x\":1}","processInstanceKey":"42"},
                   |  {"variableKey":"12","name":"b","value":"\"text\"","processInstanceKey":"42"}
                   |],"page":{"totalItems":2}}""".stripMargin
        )
        given C8RestClient = cluster.client()
        given orchescala.engine.EngineConfig = DefaultEngineConfig()
        for vars <- C8HistoricVariableService().getVariables(None, Some("42"), Some(Seq("a", "b")))
        yield
          val request = cluster.all.head
          val filter  = bodyJson(request).hcursor.downField("filter")
          val truncate = request.uri.params.get("truncateValues")
          assertTrue(
            cluster.paths == Seq("v2/variables/search"),
            truncate.contains("false"),
            filter.get[String]("processInstanceKey").contains("42"),
            filter.get[String]("scopeKey").contains("42"),
            filter.downField("name").get[Seq[String]]("$in").contains(Seq("a", "b")),
            vars.map(v => v.name -> v.value) ==
              Seq("a" -> Some(Json.obj("x" -> Json.fromInt(1))), "b" -> Some(Json.fromString("text")))
          )
      },
      test("start process: latest version, variables as JSON (numbers stay numbers), tenant") {
        val cluster = StubCluster(_ => 200 -> """{"processInstanceKey":"2251799813685249"}""")
        given C8RestClient = cluster.client()
        given orchescala.engine.EngineConfig = DefaultEngineConfig(tenantId = Some("t1"))
        for info <- C8ProcessInstanceService().startProcessAsync(
                      "my-process",
                      io.circe.JsonObject("count" -> Json.fromInt(5)),
                      Some("bk-1"),
                      None,
                      None
                    )
        yield
          val body = cluster.jsonBodies.head
          assertTrue(
            info.processInstanceId == "2251799813685249",
            cluster.paths == Seq("v2/process-instances"),
            body.hcursor.get[String]("processDefinitionId").contains("my-process"),
            body.hcursor.downField("processDefinitionVersion").failed, // -1 = latest by default
            body.hcursor.downField("variables").get[Json]("count").contains(Json.fromInt(5)),
            body.hcursor.downField("variables").get[String]("businessKey").contains("bk-1"),
            body.hcursor.get[String]("tenantId").contains("t1")
          )
      },
      test("process instance ids that are not keys fail before any call") {
        val cluster = StubCluster(_ => 200 -> "{}")
        given C8RestClient = cluster.client()
        given orchescala.engine.EngineConfig = DefaultEngineConfig()
        for exit <- C8HistoricProcessInstanceService().getProcessInstance("not-a-key").exit
        yield assertTrue(exit.isFailure, cluster.all.isEmpty)
      },
      test("deploy: multipart resources + tenant, result mapped") {
        val cluster = StubCluster(_ =>
          200 -> """{"deploymentKey":"7","tenantId":"t1","deployments":[
                   |  {"processDefinition":{"processDefinitionId":"p1","processDefinitionVersion":3,"resourceName":"p1.bpmn","tenantId":"t1","processDefinitionKey":"70"}},
                   |  {"decisionDefinition":{"decisionDefinitionId":"d1","version":1,"name":"D","tenantId":"t1","decisionRequirementsId":"r","decisionDefinitionKey":"71","decisionRequirementsKey":"72"}}
                   |]}""".stripMargin
        )
        given C8RestClient = cluster.client()
        given orchescala.engine.EngineConfig = DefaultEngineConfig(tenantId = Some("t1"))
        val resources = Seq(
          DeploymentResource("dir/p1.bpmn", "<bpmn/>".getBytes, DeploymentResourceType.Bpmn),
          DeploymentResource("d1.dmn", "<dmn/>".getBytes, DeploymentResourceType.Dmn)
        )
        for result <- C8DeploymentService().deploy("my-deployment", resources, Some(EngineType.C8))
        yield
          val parts = cluster.all.head.body match
            case MultipartBody(ps) => ps.map(p => p.name -> p.fileName)
            case _                 => Seq.empty
          assertTrue(
            cluster.paths == Seq("v2/deployments"),
            parts == Seq(
              "resources" -> Some("p1.bpmn"),
              "resources" -> Some("d1.dmn"),
              "tenantId"  -> None
            ),
            result.deploymentId == "7",
            result.deployedProcesses == Seq(ProcessDefinitionInfo("70", "p1", 3)),
            result.deployedDecisions == Seq(DecisionDefinitionInfo("71", "d1", 1))
          )
      },
      test("start by message with identity correlation: signed with the started instance's key") {
        val cluster = StubCluster: request =>
          request.uri.path.mkString("/") match
            case "v2/messages/correlation" =>
              200 -> """{"tenantId":"<default>","messageKey":"999","processInstanceKey":"4711"}"""
            case _                         => 204 -> ""
        given C8RestClient = cluster.client()
        given orchescala.engine.EngineConfig =
          DefaultEngineConfig(identitySigningKey = Some("test-signing-key"))
        val correlation = orchescala.domain.IdentityCorrelation("alice", Some("alice@example.com"))
        for info <- C8ProcessInstanceService().startProcessByMessage(
                      "start-msg",
                      businessKey = Some("bk-1"),
                      identityCorrelation = Some(correlation)
                    )
        yield
          val setVariables = cluster.all.last
          val signed       = bodyJson(setVariables).hcursor
            .downField("variables")
            .get[orchescala.domain.IdentityCorrelation]("_identityCorrelation")
            .toOption
          assertTrue(
            info.processInstanceId == "4711", // the instance, not the message key
            cluster.paths == Seq("v2/messages/correlation", "v2/element-instances/4711/variables"),
            signed.flatMap(_.processInstanceId).contains("4711"),
            signed.exists(c =>
              orchescala.domain.IdentityCorrelationSigner.verify(
                c,
                "4711",
                c.signature.get,
                "test-signing-key"
              )
            )
          )
      },
      test("a caller supplied _identityCorrelation is removed before the process starts") {
        val cluster = StubCluster(_ => 200 -> """{"processInstanceKey":"1"}""")
        given C8RestClient = cluster.client()
        given orchescala.engine.EngineConfig = DefaultEngineConfig()
        val forged = io.circe.JsonObject(
          "amount"               -> Json.fromInt(1),
          "_identityCorrelation" -> Json.obj("username" -> Json.fromString("alice"))
        )
        for _ <- C8ProcessInstanceService().startProcessAsync("p", forged, None, None, None)
        yield
          val variables = cluster.jsonBodies.head.hcursor.downField("variables")
          assertTrue(
            variables.get[Int]("amount").contains(1),
            variables.downField("_identityCorrelation").failed
          )
      }
    )
  ) @@ TestAspect.withLiveClock
end C8RestClientTest
