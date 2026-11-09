package orchescala.engine.config

import java.util.Locale

/** Pieces of the sbt code the helper generates (`project/Settings.scala`) - shared, so every
  * generator escapes and names the same way.
  */
object SbtCode:

  /** A Scala string literal of `value` - quotes and backslashes escaped. */
  def literal(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

  /** The value of an env variable in the generated build, an `Option[String]` - an empty one
    * counts as not set (e.g. a variable that is defined but empty on a pipeline).
    */
  def envValue(env: String): String =
    s"sys.env.get(${literal(env)}).filter(_.trim.nonEmpty)"

  /** The env variable with `value` as fallback - or only the literal without env variable. */
  def envOrElse(env: Option[String], value: String): String =
    env.map(e => s"${envValue(e)}.getOrElse(${literal(value)})").getOrElse(literal(value))

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
