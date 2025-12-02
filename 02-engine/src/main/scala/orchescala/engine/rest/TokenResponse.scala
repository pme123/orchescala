package orchescala.engine.rest

import orchescala.domain.*

case class TokenResponse(
                          access_token: String,
                          scope: String,
                          token_type: String,
                          refresh_token: Option[String]
                        )
object TokenResponse:
  given InOutDecoder[TokenResponse] = deriveInOutDecoder[TokenResponse]
end TokenResponse