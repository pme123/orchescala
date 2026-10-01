package orchescala.worker

import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import orchescala.worker.WorkerError.ServiceRequestError
import sttp.client3.*
import sttp.client3.asynchttpclient.zio.AsyncHttpClientZioBackend
import sttp.model.{Method, StatusCode, Uri}
import zio.*
import zio.test.*

/** A failed service call - its error message goes into the incident and the variable `errorMsg`. */
object ServiceErrorSecretsSpec extends ZIOSpecDefault:

  case class Login(user: String, password: String)
  object Login:
    given InOutCodec[Login] = deriveInOutCodec

  private object ServiceClient extends RestApiClient

  private val failingService = ZLayer.succeed[SttpClientBackend](
    AsyncHttpClientZioBackend.stub.whenAnyRequest.thenRespond(Response("backend exploded", StatusCode.InternalServerError))
  )

  private given EngineRunContext = EngineRunContext(DefaultEngineContext.example, GeneralVariables())

  private val request = RunnableRequest[Login](
    Method.POST,
    Uri.unsafeParse("http://service/login?apikey=query-secret&page=2"),
    Seq.empty,
    Some(Login("john", "body-secret")),
    Map("X-API-Key" -> "header-secret", "Cookie" -> "session=cookie-secret", "X-Request-Id" -> "req-1")
  )

  def spec = suite("The error of a failed service call")(
    test("holds no secrets - neither of headers, the query nor the body") {
      for error <- ServiceClient.sendRequest[Login, NoOutput](request).provideLayer(failingService).flip
      yield
        val message = error.errorMsg
        assertTrue(
          error.isInstanceOf[ServiceRequestError],
          !message.contains("header-secret"),
          !message.contains("cookie-secret"),
          !message.contains("query-secret"),
          !message.contains("body-secret"),
          // still enough to know what failed - the response in the incident, not in the log
          message.contains("backend exploded"),
          !orchescala.engine.LogSafe.forLog(message).contains("backend exploded"),
          // the request body too - its secret fields masked
          message.contains("--- Request body ---"),
          message.contains("\"user\":\"john\""),
          message.contains("\"password\":\"masked\""),
          !orchescala.engine.LogSafe.forLog(message).contains("john"),
          message.contains("POST"),
          message.contains("http://service/login"),
          message.contains("page=2"),
          message.contains("X-Request-Id: req-1")
        )
    },
    test("secret fields of a request body are masked - JSON (nested) and form") {
      val json = RestApiClient.maskBody(
        """{"name":"Hans","apiKey":"k1","login":{"password":"p1","clientSecret":"s1"},"items":[{"token":"t1","authorName":"A"}]}"""
      )
      val form = RestApiClient.maskBody("grant_type=password&username=hans&password=p1&client_secret=s1")
      assertTrue(
        Seq("k1", "p1", "s1", "t1").forall(v => !json.contains(v)),
        json.contains("\"name\":\"Hans\""),
        json.contains("\"authorName\":\"A\""),
        form == "grant_type=password&username=hans&password=masked&client_secret=masked"
      )
    },
    test("a long response body is shortened") {
      assertTrue(RestApiClient.truncate("x" * 5000).length < 2100)
    },
    test("sensitive names") {
      assertTrue(
        RestApiClient.isSensitive("Authorization"),
        RestApiClient.isSensitive("X-API-Key"),
        RestApiClient.isSensitive("api_key"),
        RestApiClient.isSensitive("access_token"),
        RestApiClient.isSensitive("client_secret"),
        RestApiClient.isSensitive("Cookie"),
        !RestApiClient.isSensitive("Content-Type"),
        !RestApiClient.isSensitive("page")
      )
    }
  )
end ServiceErrorSecretsSpec
