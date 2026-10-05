package orchescala.worker

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import orchescala.domain.*
import orchescala.engine.DefaultEngineConfig
import zio.*
import zio.http.*
import zio.test.*

import scala.jdk.CollectionConverters.*

object WorkerRolesSpec extends ZIOSpecDefault:

  object PingTask extends BpmnCustomTaskDsl:
    val topicName     = "test-roles-ping"
    val descr: String = "Answers with pong."

    case class In(name: String = "anna")
    object In:
      given ApiSchema[In]  = deriveApiSchema
      given InOutCodec[In] = deriveInOutCodec

    case class Out(pong: String = "pong anna")
    object Out:
      given ApiSchema[Out]  = deriveApiSchema
      given InOutCodec[Out] = deriveInOutCodec

    lazy val example = customTask(In(), Out())
  end PingTask

  class PingWorker(roles: Set[String]) extends CustomWorkerDsl[PingTask.In, PingTask.Out]:
    lazy val customTask                                                                  = PingTask.example
    override def requiredRoles: Set[String]                                              = roles
    override def runWork(in: PingTask.In): Either[WorkerError.CustomError, PingTask.Out] =
      Right(PingTask.Out(s"pong ${in.name}"))
  end PingWorker

  private def keycloakToken(realmRoles: String*) =
    JWT.create()
      .withClaim("preferred_username", "anna.berater")
      .withClaim("realm_access", Map[String, Any]("roles" -> realmRoles.asJava).asJava)
      .sign(Algorithm.HMAC256("test-only"))

  private def call(worker: PingWorker, token: String) =
    val routes  = WorkerRoutes(
      DefaultEngineContext.example.copy(workerConfig = DefaultWorkerConfig(DefaultEngineConfig()))
    ).routes(Set(worker))
    val request = Request
      .post(
        URL.decode("/worker/test-roles-ping").toOption.get,
        Body.fromString("""{"name":"anna"}""")
      )
      .addHeader(Header.Authorization.Bearer(token))
    ZIO.scoped(routes.runZIO(request))
  end call

  def spec = suite("WorkerDsl.requiredRoles")(
    test("roles come from the Keycloak and Entra claims of the token") {
      val keycloak = JWT.create()
        .withClaim("realm_access", Map[String, Any]("roles" -> List("kundenberater").asJava).asJava)
        .withClaim(
          "resource_access",
          Map[
            String,
            Any
          ]("esprit-preview-ui" -> Map[String, Any]("roles" -> List("admin").asJava).asJava).asJava
        )
        .sign(Algorithm.HMAC256("test-only"))
      val entra    = JWT.create().withClaim(
        "roles",
        List("Reviewer").asJava
      ).sign(Algorithm.HMAC256("test-only"))
      assertTrue(
        RoleClaims.fromToken(keycloak) == Set("kundenberater", "admin"),
        RoleClaims.fromToken(entra) == Set("Reviewer"),
        RoleClaims.fromToken(JWT.create().sign(Algorithm.HMAC256("test-only"))).isEmpty,
        RoleClaims.fromToken("no-jwt").isEmpty
      )
    },
    test("a user with the role calls the worker") {
      for
        response <-
          call(PingWorker(Set("kundenberater")), keycloakToken("kundenberater", "default-roles"))
        body     <- response.body.asString
      yield assertTrue(response.status == Status.Ok, body.contains("pong anna"))
    },
    test("a user without the role gets 403 - the worker does not run") {
      for
        response <- call(PingWorker(Set("kundenberater")), keycloakToken("default-roles"))
        body     <- response.body.asString
      yield assertTrue(
        response.status == Status.Forbidden,
        body.contains("needs one of the roles: kundenberater"),
        !body.contains("pong")
      )
    },
    test("one of several roles is enough") {
      call(PingWorker(Set("kundenberater", "admin")), keycloakToken("admin")).map: response =>
        assertTrue(response.status == Status.Ok)
    },
    test("without requiredRoles every caller with a token may call the worker") {
      call(PingWorker(Set.empty), keycloakToken()).map(response =>
        assertTrue(response.status == Status.Ok)
      )
    }
  )
end WorkerRolesSpec
