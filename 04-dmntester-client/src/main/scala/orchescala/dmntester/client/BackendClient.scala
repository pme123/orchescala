package orchescala.dmntester.client

import com.raquo.airstream.web.FetchStream
import com.raquo.laminar.api.L.*
import io.circe.parser.decode
import io.circe.syntax.*
import io.circe.Decoder
import orchescala.dmntester.HandledTesterException.EvalException
import orchescala.dmntester.{DmnConfig, DmnConfigGroup, DmnEvalResult}

import scala.scalajs.js.URIUtils.encodeURIComponent

/** Talks to the tester's `/api`. */
object BackendClient:

  private val api = "/api"

  def getBasePath: EventStream[Either[String, String]] =
    get[String](s"$api/basePath")

  def getEngineName: EventStream[Either[String, String]] =
    get[String](s"$api/engine")

  def getConfigPaths: EventStream[Either[String, Seq[String]]] =
    get[Seq[String]](s"$api/configPaths")

  def getConfigs(
      path: String
  ): EventStream[Either[String, Seq[DmnConfigGroup]]] =
    get[Seq[DmnConfigGroup]](s"$api/dmnConfigs?path=${encodeURIComponent(path)}")

  def updateConfig(
      dmnConfig: DmnConfig,
      path: String
  ): EventStream[Either[String, Seq[DmnConfigGroup]]] =
    send[Seq[DmnConfigGroup]](
      _.PUT,
      s"$api/dmnConfig?path=${encodeURIComponent(path)}",
      dmnConfig.asJson.noSpaces
    )

  def deleteConfig(
      dmnConfig: DmnConfig,
      path: String
  ): EventStream[Either[String, Seq[DmnConfigGroup]]] =
    send[Seq[DmnConfigGroup]](
      _.DELETE,
      s"$api/dmnConfig?path=${encodeURIComponent(path)}",
      dmnConfig.asJson.noSpaces
    )

  def runTests(
      configs: Seq[DmnConfig]
  ): EventStream[Either[String, Seq[Either[EvalException, DmnEvalResult]]]] =
    send[Seq[Either[EvalException, DmnEvalResult]]](
      _.POST,
      s"$api/runDmnTests",
      configs.asJson.noSpaces
    )

  private def get[A: Decoder](url: String): EventStream[Either[String, A]] =
    FetchStream.get(url).recoverToEither.map(toResult[A])

  private def send[A: Decoder](
      method: org.scalajs.dom.HttpMethod.type => org.scalajs.dom.HttpMethod,
      url: String,
      body: String
  ): EventStream[Either[String, A]] =
    FetchStream
      .apply(
        method,
        url,
        _.body(body),
        _.headers("Content-Type" -> "application/json")
      )
      .recoverToEither
      .map(toResult[A])

  private def toResult[A: Decoder](
      response: Either[Throwable, String]
  ): Either[String, A] =
    response.left
      .map(_.getMessage)
      .flatMap: body =>
        decode[A](body).left.map: failure =>
          // a 4xx / 5xx has the body `{"msg": "..."}` - show THAT message, not
          // that the expected answer could not be read (see DmnTesterServer)
          decode[ServerError](body)
            .map(_.msg)
            .getOrElse(
              s"Could not read the answer of the server: ${failure.getMessage}\n$body"
            )

  /** the error body of the server - see `DmnTesterServer.respond` */
  private case class ServerError(msg: String)

  private object ServerError:
    given Decoder[ServerError] = io.circe.generic.semiauto.deriveDecoder
end BackendClient
