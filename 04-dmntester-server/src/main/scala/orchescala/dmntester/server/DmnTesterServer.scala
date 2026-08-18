package orchescala.dmntester.server

import cats.effect.unsafe.implicits.global
import cats.effect.{IO as CatsIO, Resource}
import com.comcast.ip4s.*
import io.circe.syntax.*
import io.circe.{Encoder, Json}
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.*
import org.http4s.dsl.io.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.implicits.*
import org.http4s.server.Router
import org.http4s.server.middleware.CORS
import orchescala.dmntester.*
import orchescala.dmntester.server.runner.*
import zio.{Runtime, Unsafe, ZIO}

import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.duration.DurationInt

/** The DMN Tester as an app: serves the API (`/api`) and the client (`/`).
  *
  * A project starts this in-process (see `DmnTesterStarter`); `main` is there
  * for a standalone start (`TESTER_CONFIG_PATHS=... runMain`).
  */
object DmnTesterServer:

  private val running = new AtomicReference[Option[CatsIO[Unit]]](None)

  def main(args: Array[String]): Unit =
    start(DmnTesterServerConfig.fromEnv)
    awaitShutdown()

  /** Starts the tester and returns as soon as the port is bound. Starting a
    * second time is a no-op, so a project can call it from every app.
    */
  def start(config: DmnTesterServerConfig): Unit =
    if running.get().isDefined then
      println(s"DMN Tester is already running: ${url(config)}")
    else
      val service = new ZDmnService(config)
      val (_, release) = server(config, service).allocated.unsafeRunSync()
      running.set(Some(release))
      println(s"DMN Engine       : ${service.engine.name}")
      println(s"Working directory: ${os.pwd}")
      println(s"Config path(s)   : ${config.configPaths.mkString(", ")}")
      println(s"DMN Tester ready : ${url(config)}")
      if getClass.getClassLoader.getResource("webapp/index.html") == null then
        println(
          """|WARNING: the UI is not on the classpath - you only get the API.
             |         Build it once: cd 04-dmntester-client && npm ci && npm run build""".stripMargin
        )

  def stop(): Unit =
    running.getAndSet(None).foreach(_.unsafeRunSync())

  def isRunning: Boolean = running.get().isDefined

  /** blocks the calling thread while the tester is running - a project's app
    * uses this to stay alive until Ctrl-C.
    */
  def awaitShutdown(): Unit =
    while isRunning do Thread.sleep(500)

  def url(config: DmnTesterServerConfig): String =
    s"http://localhost:${config.port}"

  private def server(
      config: DmnTesterServerConfig,
      service: ZDmnService
  ): Resource[CatsIO, org.http4s.server.Server] =
    EmberServerBuilder
      .default[CatsIO]
      // 0.0.0.0 is required - otherwise docker does not work
      .withHost(ipv4"0.0.0.0")
      .withPort(Port.fromInt(config.port).get)
      .withHttpApp(CORS.policy.withAllowOriginAll(httpApp(service)))
      // the default is 30 seconds - nobody wants to wait that long for a
      // tester to stop
      .withShutdownTimeout(2.seconds)
      .build

  private def httpApp(service: ZDmnService): HttpApp[CatsIO] =
    Router(
      "/api" -> apiServices(service),
      "/" -> guiServices(service)
    ).orNotFound

  private object PathQueryParamMatcher
      extends OptionalQueryParamDecoderMatcher[String]("path")

  private object ConfigPathQueryParamMatcher
      extends OptionalQueryParamDecoderMatcher[String]("configPath")

  private def apiServices(service: ZDmnService) = HttpRoutes.of[CatsIO]:
    case GET -> Root / "basePath"    => respond(service.basePath())
    case GET -> Root / "engine"      => respond(service.engineName())
    case GET -> Root / "configPaths" => respond(service.loadConfigPaths())

    case GET -> Root / "dmnConfigs" :? PathQueryParamMatcher(path)
        +& ConfigPathQueryParamMatcher(configPath) =>
      decodePath(path orElse configPath) match
        case Nil      => respond(ZIO.succeed(Seq.empty[DmnConfigGroup]))
        case segments => respond(service.loadConfigs(segments))

    case req @ POST -> Root / "runDmnTests" =>
      req.as[Seq[DmnConfig]].flatMap(configs => respond(service.runTests(configs)))

    case req @ PUT -> Root / "dmnConfig" :? PathQueryParamMatcher(path)
        +& ConfigPathQueryParamMatcher(configPath) =>
      req
        .as[DmnConfig]
        .flatMap: config =>
          respond(service.updateConfig(config, decodePath(path orElse configPath)))

    case req @ DELETE -> Root / "dmnConfig" :? PathQueryParamMatcher(path)
        +& ConfigPathQueryParamMatcher(configPath) =>
      req
        .as[DmnConfig]
        .flatMap: config =>
          respond(service.deleteConfig(config, decodePath(path orElse configPath)))

  private def guiServices(service: ZDmnService) = HttpRoutes.of[CatsIO]:
    // the starter polls this to see if the port is taken by another project
    case GET -> Root / "info" =>
      unsafeRun(service.startingApp()).flatMap(Ok(_))
    case req if req.method == Method.OPTIONS => Ok()
    case req @ GET -> Root                   => static("index.html", req)
    case req @ GET -> path                   => static(path.toString, req)

  /** serves the linked client from the classpath (the `webapp` resources of
    * this jar - see the `dmnTesterClient` module).
    */
  private def static(file: String, request: Request[CatsIO]): CatsIO[Response[CatsIO]] =
    val resource = file.stripPrefix("/")
    StaticFile
      .fromResource[CatsIO](s"webapp/$resource", Some(request))
      .getOrElseF(NotFound(s"Not found: $resource"))

  private def decodePath(path: Option[String]): Seq[String] =
    path.toSeq.flatMap: p =>
      val decoded = URLDecoder.decode(p, StandardCharsets.UTF_8)
      decoded.split("/").map(_.trim).filter(_.nonEmpty).toSeq

  /** runs a ZIO and turns a domain error into a `400` with its message. */
  private def respond[E <: HandledTesterException, A: Encoder](
      body: ZIO[Any, E, A]
  ): CatsIO[Response[CatsIO]] =
    unsafeRun(body.either).flatMap:
      case Right(value) => Ok(value.asJson)
      case Left(error)  =>
        BadRequest(Json.obj("msg" -> Json.fromString(error.msg)))

  private def unsafeRun[A](body: ZIO[Any, Nothing, A]): CatsIO[A] =
    CatsIO.fromFuture(CatsIO(Unsafe.unsafe { implicit unsafe =>
      Runtime.default.unsafe.runToFuture(body)
    }))
end DmnTesterServer
