package orchescala.engine.rest

import sttp.client3.*
import sttp.model.Uri

trait OAuth2Flow :
  protected def identityUrl: Uri
  
  protected lazy val tokenRequest =
    basicRequest
      .post(identityUrl)
      .header("accept", "application/json")
      .header("content-type", "application/x-www-form-urlencoded")

  protected lazy val syncBackend: SttpBackend[Identity, Any] = HttpClientSyncBackend()
