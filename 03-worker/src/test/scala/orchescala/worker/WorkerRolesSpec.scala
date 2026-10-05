package orchescala.worker

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.sun.net.httpserver.HttpServer
import orchescala.domain.*
import orchescala.engine.DefaultEngineConfig
import orchescala.engine.auth.TokenValidation
import zio.*
import zio.http.*
import zio.test.*

import java.net.InetSocketAddress
import java.security.KeyPairGenerator
import java.security.interfaces.{RSAPrivateKey, RSAPublicKey}
import java.time.Instant
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import scala.jdk.CollectionConverters.*

/** Roles with verified tokens: a JWKS endpoint of its own, tokens signed with its RSA key. */
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

  /** Counts its runs - proves that a refused call does not run the worker. */
  class PingWorker(roles: Set[String]) extends CustomWorkerDsl[PingTask.In, PingTask.Out]:
    val runs                                                                             = AtomicInteger(0)
    lazy val customTask                                                                  = PingTask.example
    override def requiredRoles: Set[String]                                              = roles
    override def runWork(in: PingTask.In): Either[WorkerError.CustomError, PingTask.Out] =
      runs.incrementAndGet()
      Right(PingTask.Out(s"pong ${in.name}"))
  end PingWorker

  // ---- a small identity provider: RSA key, JWKS over HTTP
  private val issuer         = "https://sso.test/realms/test"
  private lazy val keyPair   =
    val generator = KeyPairGenerator.getInstance("RSA")
    generator.initialize(2048)
    generator.generateKeyPair()
  private lazy val algorithm =
    Algorithm.RSA256(
      keyPair.getPublic.asInstanceOf[RSAPublicKey],
      keyPair.getPrivate.asInstanceOf[RSAPrivateKey]
    )

  /** Where the test IdP serves its keys - a JDK HttpServer, stopped with the suite. */
  case class Jwks(url: String)

  private val jwks: ZLayer[Any, Throwable, Jwks] = ZLayer.scoped:
    ZIO
      .acquireRelease(ZIO.attempt:
        val key                          = keyPair.getPublic.asInstanceOf[RSAPublicKey]
        def b64(n: java.math.BigInteger) =
          Base64.getUrlEncoder.withoutPadding.encodeToString(n.toByteArray.dropWhile(_ == 0))
        val body                         =
          s"""{"keys":[{"kty":"RSA","kid":"test","use":"sig","alg":"RS256","n":"${b64(
              key.getModulus
            )}","e":"${b64(key.getPublicExponent)}"}]}"""
        val server                       = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext(
          "/certs",
          exchange =>
            val bytes = body.getBytes
            exchange.getResponseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, bytes.length)
            exchange.getResponseBody.write(bytes)
            exchange.close()
        )
        server.start()
        server)(server => ZIO.succeed(server.stop(0)))
      .map(server => Jwks(s"http://127.0.0.1:${server.getAddress.getPort}/certs"))

  private def token(claims: (String, Any)*) =
    claims.foldLeft(
      JWT.create().withIssuer(issuer).withKeyId("test").withExpiresAt(Instant.now.plusSeconds(300))
    ):
      case (jwt, (name, value: String))              => jwt.withClaim(name, value)
      case (jwt, (name, value: java.util.List[?]))   => jwt.withClaim(name, value)
      case (jwt, (name, value: java.util.Map[?, ?])) =>
        jwt.withClaim(name, value.asInstanceOf[java.util.Map[String, ?]])
      case (jwt, _)                                  => jwt
    .sign(algorithm)

  private def realmRoles(roles: String*) =
    "realm_access" -> Map[String, Any]("roles" -> roles.asJava).asJava

  private def verified(jwks: Jwks, clients: Set[String] = Set.empty): WorkerConfig =
    new DefaultWorkerConfig(
      DefaultEngineConfig(),
      tokenValidation = TokenValidation.Jwt(issuer, jwksUrl = Some(jwks.url))
    ):
      override def roleClients: Set[String] = clients

  private def call(worker: PingWorker, token: String, config: Option[WorkerConfig] = None) =
    for
      jwks     <- ZIO.service[Jwks]
      response <- callWith(worker, token, config.getOrElse(verified(jwks)))
    yield response

  private def callWith(worker: PingWorker, token: String, config: WorkerConfig) =
    val routes  =
      WorkerRoutes(DefaultEngineContext.example.copy(workerConfig = config)).routes(Set(worker))
    val request = Request
      .post(
        URL.decode("/worker/test-roles-ping").toOption.get,
        Body.fromString("""{"name":"anna"}""")
      )
      .addHeader(Header.Authorization.Bearer(token))
    ZIO.scoped(routes.runZIO(request))
  end callWith

  def spec = suite("WorkerDsl.requiredRoles")(
    suite("RoleClaims")(
      test("app roles (Entra) and realm roles (Keycloak) count") {
        assertTrue(
          RoleClaims.fromToken(token(realmRoles("kundenberater"))) == Set("kundenberater"),
          RoleClaims.fromToken(token("roles" -> List("Reviewer").asJava)) == Set("Reviewer"),
          RoleClaims.fromToken(token(
            "roles" -> List("Reviewer").asJava,
            realmRoles("kundenberater")
          )) ==
            Set("Reviewer", "kundenberater")
        )
      },
      test("client roles count only for the configured clients") {
        val clientRoles = token(
          "resource_access" -> Map[String, Any](
            "other-app" -> Map[String, Any]("roles" -> List("admin").asJava).asJava,
            "my-app"    -> Map[String, Any]("roles" -> List("kundenberater").asJava).asJava
          ).asJava
        )
        assertTrue(
          RoleClaims.fromToken(clientRoles).isEmpty,
          RoleClaims.fromToken(clientRoles, Set("my-app")) == Set("kundenberater")
        )
      },
      test("app, realm and configured client roles together") {
        val all = token(
          "roles"           -> List("Reviewer").asJava,
          realmRoles("kundenberater"),
          "resource_access" -> Map[String, Any](
            "my-app"    -> Map[String, Any]("roles" -> List("admin").asJava).asJava,
            "other-app" -> Map[String, Any]("roles" -> List("root").asJava).asJava
          ).asJava
        )
        assertTrue(RoleClaims.fromToken(
          all,
          Set("my-app")
        ) == Set("Reviewer", "kundenberater", "admin"))
      },
      test("a claim in an unexpected format gives no roles - never an error") {
        assertTrue(
          RoleClaims.fromToken(token("roles" -> List(Map[String, Any]().asJava).asJava)).isEmpty,
          RoleClaims.fromToken(token("roles" -> "kundenberater")).isEmpty,
          RoleClaims.fromToken(token("realm_access" -> "kundenberater")).isEmpty,
          RoleClaims.fromToken("no-jwt").isEmpty
        )
      }
    ),
    test("a user with the role calls the worker") {
      val worker = PingWorker(Set("kundenberater"))
      for
        response <- call(worker, token(realmRoles("kundenberater", "default-roles")))
        body     <- response.body.asString
      yield assertTrue(
        response.status == Status.Ok,
        body.contains("pong anna"),
        worker.runs.get == 1
      )
      end for
    },
    test(
      "a user without the role gets 403 - the worker does not run, the roles are not disclosed"
    ) {
      val worker = PingWorker(Set("kundenberater"))
      for
        response <- call(worker, token(realmRoles("default-roles")))
        body     <- response.body.asString
      yield assertTrue(
        response.status == Status.Forbidden,
        body.contains("Not allowed to call worker 'test-roles-ping'"),
        !body.contains("kundenberater"),
        worker.runs.get == 0
      )
      end for
    },
    test("a token without any role claim is 403") {
      val worker = PingWorker(Set("kundenberater"))
      call(worker, token("preferred_username" -> "anna.berater")).map: response =>
        assertTrue(response.status == Status.Forbidden, worker.runs.get == 0)
    },
    test("one of several roles is enough") {
      call(PingWorker(Set("kundenberater", "admin")), token(realmRoles("admin"))).map: response =>
        assertTrue(response.status == Status.Ok)
    },
    test("a client role counts only for a configured client") {
      val worker = PingWorker(Set("kundenberater"))
      val tok    = token(
        "resource_access" -> Map[
          String,
          Any
        ]("my-app" -> Map[String, Any]("roles" -> List("kundenberater").asJava).asJava).asJava
      )
      for
        other <- call(worker, tok)
        jwks  <- ZIO.service[Jwks]
        mine  <- callWith(worker, tok, verified(jwks, Set("my-app")))
      yield assertTrue(other.status == Status.Forbidden, mine.status == Status.Ok)
      end for
    },
    test("a malformed roles claim is 403, not 500") {
      val worker = PingWorker(Set("kundenberater"))
      call(worker, token("roles" -> List(Map[String, Any]().asJava).asJava)).map: response =>
        assertTrue(response.status == Status.Forbidden, worker.runs.get == 0)
    },
    test("a failing rolesOf is 503 - not \"no role\" - and the worker does not run") {
      val worker = PingWorker(Set("kundenberater"))
      for
        jwks     <- ZIO.service[Jwks]
        failing   = new DefaultWorkerConfig(
                      DefaultEngineConfig(),
                      tokenValidation = TokenValidation.Jwt(issuer, jwksUrl = Some(jwks.url))
                    ):
                      override def rolesOf(token: String): Set[String] =
                        throw IllegalStateException("IdP down")
        response <- callWith(worker, token(realmRoles("kundenberater")), failing)
      yield assertTrue(response.status == Status.ServiceUnavailable, worker.runs.get == 0)
      end for
    },
    test("only Jwt and AnyOf verify - the gate for roles and the audit user") {
      val jwt = TokenValidation.Jwt(issuer)
      assertTrue(
        !TokenValidation.PresenceOnly.verifies,
        jwt.verifies,
        TokenValidation.AnyOf(jwt).verifies
      )
    },
    test("without verified tokens a worker with roles refuses every call - fails closed") {
      val worker = PingWorker(Set("kundenberater"))
      callWith(
        worker,
        token(realmRoles("kundenberater")),
        DefaultWorkerConfig(DefaultEngineConfig())
      ).map: response =>
        assertTrue(response.status == Status.Forbidden, worker.runs.get == 0)
    },
    test("without requiredRoles every caller with a valid token may call the worker") {
      val worker = PingWorker(Set.empty)
      call(worker, token()).map(response =>
        assertTrue(response.status == Status.Ok, worker.runs.get == 1)
      )
    }
  ).provideShared(jwks.orDie)
    @@ TestAspect.withLiveClock // the JWT verifier caches the keys by the clock - TestClock starts at 0
end WorkerRolesSpec
