package orchescala.worker

import com.auth0.jwt.JWT

import scala.jdk.CollectionConverters.*
import scala.util.Try

/** The roles of a user from the claims of the Bearer token - the default of `WorkerConfig.rolesOf`:
  *
  *   - `roles` - app roles of Entra ID (and of Keycloak with a role mapper)
  *   - `realm_access.roles` - realm roles of Keycloak
  *   - `resource_access.{client}.roles` - client roles of Keycloak
  *
  * The token is only decoded - it is trusted because the worker app verified it before (with
  * `TokenValidation.Jwt` / `AnyOf`).
  */
object RoleClaims:

  def fromToken(token: String): Set[String] =
    Try(JWT.decode(token)).toOption.fold(Set.empty[String]): jwt =>
      val appRoles    = Option(jwt.getClaim("roles").asList(classOf[String])).map(_.asScala.toSet)
      val realmRoles  = Option(jwt.getClaim("realm_access").asMap()).map(m => roles(m.get("roles")))
      val clientRoles = Option(jwt.getClaim("resource_access").asMap()).map:
        _.asScala.values.flatMap:
          case client: java.util.Map[?, ?] => roles(client.get("roles"))
          case _                           => Set.empty
        .toSet
      appRoles.getOrElse(Set.empty) ++ realmRoles.getOrElse(Set.empty) ++ clientRoles.getOrElse(
        Set.empty
      )

  private def roles(value: Any): Set[String] =
    value match
      case list: java.util.List[?] => list.asScala.collect { case role: String => role }.toSet
      case _                       => Set.empty

end RoleClaims
