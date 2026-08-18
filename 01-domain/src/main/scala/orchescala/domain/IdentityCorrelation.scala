package orchescala.domain

import orchescala.domain.*
import sttp.tapir.Schema.annotations.description


case class IdentityCorrelation(
    @description("The username of the user that started or interacted with the process")
    username: String,
    @description("The email of the user that started or interacted with the process")
    email: Option[String] = None,
    @description(
      """An optional value that you need to verify the identity.
        |E.g. the id of the customer.
        |Be aware that the value needs to be in the input body of starting the process or completing a user task.""".stripMargin)
    impersonateProcessValue: Option[String] = None,
    @description("The timestamp (milliseconds since epoch) when the identity correlation was created")
    issuedAt: Long = System.currentTimeMillis(),
    @description("The process instance ID this correlation is bound to (set after process start)")
    processInstanceId: Option[String] = None,
    @description("HMAC signature binding the identity to the process instance")
    signature: Option[String] = None
):

  override def toString: String =
    s"""IdentityCorrelation:
       |- username: $username
       |- email: ${email.getOrElse("-")}
       |- impersonateProcessValue: ${impersonateProcessValue.getOrElse("-")}
       |- processInstanceId: ${processInstanceId.getOrElse("-")}
       |- issuedAt: $issuedAt
       |- signature: ${signature.map(_ => "***").getOrElse("-")}
       |""".stripMargin
end IdentityCorrelation

object IdentityCorrelation:
  given InOutCodec[IdentityCorrelation] = deriveInOutCodec[IdentityCorrelation]
  given ApiSchema[IdentityCorrelation] = deriveApiSchema[IdentityCorrelation]

  lazy val example = IdentityCorrelation(
    username = "myUser",
    email = Some("myUser@orchescala.ch"),
    impersonateProcessValue = Some("1234567890")
  )
