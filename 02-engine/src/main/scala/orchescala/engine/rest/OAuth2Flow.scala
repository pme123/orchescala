package orchescala.engine.rest

import sttp.client3.*
import sttp.model.Uri

import scala.concurrent.duration.*

trait OAuth2Flow :
  protected def identityUrl: Uri

  protected lazy val tokenRequest =
    basicRequest
      .post(identityUrl)
      .header("accept", "application/json")
      .header("content-type", "application/x-www-form-urlencoded")
      .readTimeout(10.seconds)  // prevent indefinite blocking when SSO is unreachable

  protected lazy val syncBackend: SttpBackend[Identity, Any] =
    HttpClientSyncBackend(options = SttpBackendOptions.connectionTimeout(10.seconds))
