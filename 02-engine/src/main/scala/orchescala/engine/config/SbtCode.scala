package orchescala.engine.config

import java.util.Locale

/** Pieces of the sbt code the helper generates (`project/Settings.scala`) - shared, so every
  * generator escapes and names the same way.
  */
object SbtCode:

  private val trailingSlashes = "/+$"
  // the host of an authority `user@host:port` - for a host that java.net.URI does not accept as
  // one (e.g. with `_`, then `getHost` is null)
  private[config] val authorityToHost = "^.*@|:[0-9]*$"
  // everything up to the last `@` (after the scheme, if there is one) - user info may have a
  // password, also one with a `/`, or a url without `//`
  private val userInfo            = "^([a-zA-Z][a-zA-Z0-9+.-]*://)?.*@"
  private val userInfoMasked      = "$1***@"
  private val userInfoRemoved     = "$1"

  /** A Scala string literal of `value` - quotes and backslashes escaped. */
  def literal(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

  /** The value of an env variable in the generated build, an `Option[String]` - trimmed, an empty
    * one counts as not set (e.g. a variable that is defined but empty on a pipeline).
    */
  def envValue(env: String): String =
    s"sys.env.get(${literal(env)}).map(_.trim).filter(_.nonEmpty)"

  /** The env variable with `value` as fallback - or only the literal without env variable. */
  def envOrElse(env: Option[String], value: String): String =
    env.map(e => s"${envValue(e)}.getOrElse(${literal(value)})").getOrElse(literal(value))

  /** A url without spaces around and without the slashes at the end - the helper and the
    * generated build (`envUrlOrElse`) read the url of a variable the same way.
    */
  def trimUrl(url: String): String = url.trim.replaceAll(trailingSlashes, "")

  /** The url of an env variable in the generated build (as `trimUrl`) with `url` as fallback - or
    * only the literal without env variable.
    */
  def envUrlOrElse(env: Option[String], url: String): String =
    env
      .map(e => s"${envUrl(e)}.getOrElse(${literal(url)})")
      .getOrElse(literal(url))

  /** As `envUrlOrElse`, but a block that prints a warning when the variable is not set - the url
    * then is the one of the last `./helper.scala update` (maybe of another machine).
    */
  def envUrlOrElseWarn(env: Option[String], url: String, indent: String): String =
    env
      .map: e =>
        val warning = literal(s"[warn] $e is not set - the repo of the last ./helper.scala update: $url")
        s"""${envUrl(e, warnUserInfo = true)}.getOrElse {
           |$indent  println($warning)
           |$indent  ${literal(url)}
           |$indent}""".stripMargin
      .getOrElse(literal(url))

  /** A url for a message - the user info masked: the part up to the last `@` becomes `***@`. */
  def maskUserInfo(url: String): String = url.replaceAll(userInfo, userInfoMasked)

  /** `maskUserInfo` in the generated build - of the String expression `urlExpr`. */
  def maskUserInfoExpr(urlExpr: String): String =
    s"$urlExpr.replaceAll(${literal(userInfo)}, ${literal(userInfoMasked)})"

  /** The url of an env variable in the generated build, an `Option[String]` (as `trimUrl`) -
    * without user info: sbt/coursier would log it with the password (e.g. a resolver url it can
    * not parse); the credentials are in the `..._USERNAME` / `_PASSWORD` variables. With
    * `warnUserInfo` a removed user info gives a warning (masked).
    */
  private def envUrl(env: String, warnUserInfo: Boolean = false): String =
    val warning =
      if warnUserInfo then
        val text = literal(
          s"[warn] $env has user info - it is removed, the credentials are in the ..._USERNAME / _PASSWORD variables: "
        )
        s"""if (u.contains("@")) println($text + ${maskUserInfoExpr("u")}); """
      else ""
    s"sys.env.get(${literal(env)}).map(_.trim.replaceAll(${literal(trailingSlashes)}, ${literal("")})).filter(_.nonEmpty)" +
      s".map { u => ${warning}u.replaceAll(${literal(userInfo)}, ${literal(userInfoRemoved)}) }"

  /** The host of a url in the generated build (as `RepoConfig.hostOf`), an `Option[String]`. */
  def hostOf(uriExpr: String): String =
    s"scala.util.Try(java.net.URI.create($uriExpr)).toOption" +
      s".flatMap(u => Option(u.getHost).orElse(Option(u.getRawAuthority).map(_.replaceAll(${literal(authorityToHost)}, ${literal("")}))))" +
      ".filter(_.nonEmpty)"

  /** The prefix of the env variables of a company: upper case (independent of the locale), every
    * character other than a letter or digit as `_` - e.g. `acme-bank` -> `ACME_BANK`.
    */
  def companyEnvPrefix(companyName: String): String =
    companyName.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "_")

  /** The env variable `{COMPANY}_{suffix}`, e.g. `ACME_MVN_RELEASE_REPOSITORY`. */
  def companyEnvName(companyName: String, suffix: String): String =
    s"${companyEnvPrefix(companyName)}_$suffix"

  /** The start of a Scala identifier: lower case, only letters and digits - prefixed with `repo`
    * if that is empty or starts with a digit (`3m` -> `repo3m`).
    */
  def identifier(name: String): String =
    val id = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "")
    if id.isEmpty || id.head.isDigit then s"repo$id" else id

end SbtCode
