package orchescala.engine

import orchescala.domain.*

case class EngineConfig(
    tenantId: Option[String] = None,
    @description("The key of the process variable that contains an additional value to verify the impersonate User")
    impersonateProcessKey: Option[String] = None,
    @description("Secret key for signing IdentityCorrelation (HMAC-SHA256). Should be set from environment variable.")
    identitySigningKey: Option[String] = sys.env.get("ORCHESCALA_IDENTITY_SIGNING_KEY")
)
