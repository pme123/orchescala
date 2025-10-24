package orchescala.engine

import zio.*

/** Authentication context that can be passed through the service layer.
  *
  * This allows passing authentication tokens from the HTTP layer down to the engine clients
  * without modifying all service method signatures.
  */
case class AuthContext(bearerToken: Option[String] = None)

object AuthContext:

  /** FiberRef to store the authentication context for the current fiber */
  val fiberRef: FiberRef[AuthContext] =
    Unsafe.unsafe { implicit unsafe =>
      FiberRef.unsafe.make(AuthContext())
    }

  /** Get the current authentication context */
  def get: UIO[AuthContext] = fiberRef.get

  /** Set the authentication context for the current fiber */
  def set(context: AuthContext): UIO[Unit] = fiberRef.set(context)

  /** Set the bearer token in the authentication context */
  def setBearerToken(token: String): UIO[Unit] =
    fiberRef.set(AuthContext(bearerToken = Some(token)))

  /** Get the bearer token from the authentication context */
  def getBearerToken: UIO[Option[String]] =
    fiberRef.get.map(_.bearerToken)

  /** Run a ZIO effect with the given authentication context */
  def withContext[R, E, A](context: AuthContext)(effect: ZIO[R, E, A]): ZIO[R, E, A] =
    fiberRef.locally(context)(effect)

  /** Run a ZIO effect with the given bearer token */
  def withBearerToken[R, E, A](token: String)(effect: ZIO[R, E, A]): ZIO[R, E, A] =
    fiberRef.locally(AuthContext(bearerToken = Some(token)))(effect)

end AuthContext

