package orchescala.engine.rest

import sttp.client3.*

sealed trait OAuthConfig:

  def ssoRealm: String
  def ssoBaseUrl: String
  def client_id: String
  def client_secret: String
  def scope: String
  def grantType: String

  def identityUrl = uri"$ssoBaseUrl/realms/$ssoRealm/protocol/openid-connect/token"

  def asMap: Map[String, String] = Map(
    "grant_type"    -> grantType,
    "client_id"     -> client_id,
    "client_secret" -> client_secret,
    "scope"         -> scope
  )

  override def toString: String =
    s"""OAuthConfig:
       |- ssoRealm: $ssoRealm
       |- ssoBaseUrl: $ssoBaseUrl
       |- client_id: $client_id
       |- client_secret: ${client_secret.take(5)}***"
       |- scope: $scope
       |- grantType: $grantType
       |""".stripMargin
end OAuthConfig

object OAuthConfig:

  case class PasswordGrant(
      ssoRealm: String,
      ssoBaseUrl: String,
      client_id: String,
      client_secret: String,
      scope: String,
      username: String,
      password: String
  ) extends OAuthConfig:
    val grantType = "password"

    override def asMap: Map[String, String] =
      super.asMap ++ Map(
        "username" -> username,
        "password" -> password
      )

    val clientCredentialsConfig: OAuthConfig.ClientCredentials = ClientCredentials(
      ssoRealm = ssoRealm,
      ssoBaseUrl = ssoBaseUrl,
      client_id = client_id,
      client_secret = client_secret,
      scope = scope
    )

    override def toString: String =
      super.toString +
        s"""- username: $username
           |- password: ${password.take(2)}***"
           |""".stripMargin

  end PasswordGrant

  case class ClientCredentials(
      ssoRealm: String,
      ssoBaseUrl: String,
      client_id: String,
      client_secret: String,
      scope: String
  ) extends OAuthConfig:
    val grantType = "client_credentials"

  end ClientCredentials

  case class TokenExchange(
      clientCredConfig: ClientCredentials
  ) extends OAuthConfig:
    val grantType     = "urn:ietf:params:oauth:grant-type:token-exchange"
    val ssoRealm     = clientCredConfig.ssoRealm
    val ssoBaseUrl   = clientCredConfig.ssoBaseUrl
    val client_id     = clientCredConfig.client_id
    val client_secret = clientCredConfig.client_secret
    val scope         = clientCredConfig.scope

    override def asMap: Map[String, String] = Map.empty // must not be used

    def asMap(username: String, adminToken: String): Map[String, String] =
      super.asMap ++ Map(
        "requested_subject" -> username,
        "subject_token" -> adminToken
      )

    def toString(username: String, adminToken: String): String =
      super.toString +
        s"""- requested_subject: $username
           |- subject_token: ${adminToken.take(5)}***"
           |""".stripMargin
  end TokenExchange

end OAuthConfig
