package orchescala.domain

import orchescala.domain.*
import sttp.tapir.Schema.annotations.description


case class IdentityCorrelation(
    @description("The username of the user that started or interacted with the process")
    username: String,
    @description("The secret the worker will check against the username to verify the identity")
    secret: Option[String] = None,
    @description("The email of the user that started or interacted with the process")
    email: Option[String] = None,
    @description("An optional value that you need to verify the identity. E.g. the id of the customer.")
    impersonateProcessValue: Option[String] = None
):

  override def toString: String =
    s"""IdentityCorrelation:
       |- username: $username
       |- email: ${email.getOrElse("-")}
       |- secret: ${secret.getOrElse("-")}
       |- impersonateProcessValue: ${impersonateProcessValue.getOrElse("-")}
       |""".stripMargin
end IdentityCorrelation

object IdentityCorrelation:
  given InOutCodec[IdentityCorrelation] = deriveInOutCodec[IdentityCorrelation]
  given ApiSchema[IdentityCorrelation] = deriveApiSchema[IdentityCorrelation]
