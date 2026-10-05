package orchescala.worker

import com.auth0.jwt.JWT

import scala.jdk.CollectionConverters.*
import scala.util.Try

/** The roles of a user from the claims of the Bearer token - the default of `WorkerConfig.rolesOf`:
  *
  *   - `roles` - app roles of Entra ID (and of Keycloak with a role mapper)
  *   - `realm_access.roles` - realm roles of Keycloak
  *   - `resource_access.{client}.roles` - client roles of Keycloak, only for the given `clients`
  *     (`WorkerConfig.roleClients`): a role `admin` of another app must not count here
  *
  * The token is only decoded - it is trusted because the worker app verified it before. A claim in
  * an unexpected format gives no roles (the call is refused), never an error.
  */
object RoleClaims:

  def fromToken(token: String, clients: Set[String] = Set.empty): Set[String] =
    Try {
      val jwt                      = JWT.decode(token)
      val claims                   = jwt.getClaims.asScala
      def claim(name: String): Any = claims.get(name).map(_.as(classOf[Object])).orNull
      val appRoles                 = roles(claim("roles"))
      val realmRoles               = roles(field(claim("realm_access"), "roles"))
      val clientRoles              =
        clients.flatMap(client => roles(field(field(claim("resource_access"), client), "roles")))
      appRoles ++ realmRoles ++ clientRoles
    }.getOrElse(Set.empty)

  private def field(value: Any, name: String): Any =
    value match
      case map: java.util.Map[?, ?] => map.get(name)
      case _                        => null

  private def roles(value: Any): Set[String] =
    value match
      case list: java.util.List[?] => list.asScala.collect { case role: String => role }.toSet
      case _                       => Set.empty[String]

end RoleClaims
