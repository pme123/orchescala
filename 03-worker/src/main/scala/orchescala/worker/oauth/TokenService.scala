package orchescala.worker
package oauth

import orchescala.worker.SttpClientBackend
import orchescala.worker.WorkerError.ServiceAuthError
import sttp.client3.*
import sttp.client3.circe.*
import sttp.model.Uri

class TokenService(
    identityUrl: Uri,
    adminTokenBody: Map[String, String],
    clientCredentialsBody: Map[String, String],
    impersonateBody: Map[String, String]
):

  def adminToken(): Either[ServiceAuthError, String] =
    authAdminResponse
      .body
      .map(t => s"Bearer ${t.access_token}")
      .left
      .map(err =>
        ServiceAuthError(
          s"Could not get a token for '${adminTokenBody("username")}'!\n$err\n\n$identityUrl"
        )
      )

  def clientCredentialsToken(): Either[ServiceAuthError, String] =
    authClientCredentialsResponse
      .body
      .map(t => s"Bearer ${t.access_token}")
      .left
      .map(err =>
        ServiceAuthError(
          s"Could not get a token for '${clientCredentialsBody("client_id")}' -> ClientCredentials!\n$err\n\n$identityUrl"
        )
      )

  def impersonateToken(username: String, adminToken: String): IO[ServiceAuthError, String] =
    val token = adminToken.replace("Bearer ", "")
    val body  = impersonateBody ++ Map("requested_subject" -> username, "subject_token" -> token)
    ZIO.fromEither(authImpersonateResponse(body)
      .body
      .map(t => s"Bearer ${t.access_token}")).mapError(err =>
      ServiceAuthError(
        s"Could not get impersonated token for $username - ${token.take(20)}...${token.takeRight(10)}!\n$err\n\n$identityUrl"
      )
    )
  end impersonateToken

  private lazy val tokenRequest =
    basicRequest
      .post(identityUrl)
      .header("accept", "application/json")

  def adminTokenZio(): ZIO[SttpClientBackend, ServiceAuthError, String] =
    ZIO.serviceWithZIO[SttpClientBackend]: backend =>
      tokenRequest.body(adminTokenBody)
        .response(asJson[TokenResponse])
        .send(backend)
        .map(_.body.map(t => s"Bearer ${t.access_token}"))
        .flatMap(ZIO.fromEither)
        .mapError(err =>
          ServiceAuthError(
            s"Could not get a token for '${adminTokenBody("username")}'!\n$err\n\n$identityUrl"
          )
        )

  def clientCredentialsTokenZio(): ZIO[SttpClientBackend, ServiceAuthError, String] =
    ZIO.serviceWithZIO[SttpClientBackend]: backend =>
      tokenRequest.body(clientCredentialsBody)
        .response(asJson[TokenResponse])
        .send(backend)
        .map(_.body.map(t => s"Bearer ${t.access_token}"))
        .flatMap(ZIO.fromEither)
        .mapError(err =>
          ServiceAuthError(
            s"Could not get a token for '${clientCredentialsBody("client_id")}' -> ClientCredentials!\n$err\n\n$identityUrl"
          )
        )

  private lazy val syncBackend: SttpBackend[Identity, Any] = HttpClientSyncBackend()

  private def authAdminResponse =
    println(s"authAdminResponse: ${identityUrl}")
    tokenRequest.body(adminTokenBody).response(asJson[TokenResponse]).send(syncBackend)

  private def authClientCredentialsResponse =
    tokenRequest.body(clientCredentialsBody).response(asJson[TokenResponse]).send(syncBackend)

  private def authImpersonateResponse(body: Map[String, String]) =
    tokenRequest.body(body).response(asJson[TokenResponse]).send(syncBackend)
end TokenService
