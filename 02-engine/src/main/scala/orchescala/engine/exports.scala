package orchescala.engine

import orchescala.BuildInfo

def banner(applicationName: String) =
  s"""
     |
     |..#######..########...######..##.....##.########..######...######.....###....##..........###...
     |.##.....##.##.....##.##....##.##.....##.##.......##....##.##....##...##.##...##.........##.##..
     |.##.....##.##.....##.##.......##.....##.##.......##.......##........##...##..##........##...##.
     |.##.....##.########..##.......#########.######....######..##.......##.....##.##.......##.....##
     |.##.....##.##...##...##.......##.....##.##.............##.##.......#########.##.......#########
     |.##.....##.##....##..##....##.##.....##.##.......##....##.##....##.##.....##.##.......##.....##
     |..#######..##.....##..######..##.....##.########..######...######..##.....##.########.##.....##
     |
     |                                                        >>> DOMAIN DRIVEN PROCESS ORCHESTRATION
     |  $applicationName
     |
     |  Orchescala: ${BuildInfo.version}
     |  Scala: ${BuildInfo.scalaVersion}
     |""".stripMargin

/** Removes `_identityCorrelation` from variables a caller passes in (start, message, signal, user
  * task completion). Only the engine services set it - signed for the process instance it belongs
  * to. Passed through, a correlation copied from another process (logs, variable history) reached
  * the workers as if the engine had set it, and they acted as that user.
  */
def withoutCallerIdentityCorrelation(variables: JsonObject): zio.UIO[JsonObject] =
  val keys    = Seq(
    orchescala.domain.InputParams._identityCorrelation,
    orchescala.domain.InputParams._identityCorrelationPending
  ).map(_.toString)
  val present = keys.filter(variables.contains)
  if present.nonEmpty then
    zio.ZIO
      .logWarning(s"Removed ${present.mkString("`", "`, `", "`")} from the caller's variables - only the engine sets it.")
      .as(present.foldLeft(variables)(_.remove(_)))
  else zio.ZIO.succeed(variables)
end withoutCallerIdentityCorrelation

/** Marks a process started with an identity: its signed correlation is set right after the start
  * (the signature needs the process instance id) - a worker fetching a job in between waits for it
  * instead of running without the user's identity.
  */
def withIdentityPending(variables: JsonObject): JsonObject =
  variables.add(orchescala.domain.InputParams._identityCorrelationPending.toString, Json.True)

extension (jsonObj: JsonObject)
  def toVariablesMap: Map[String, Json] =
    jsonObj.toMap.map:
      case (k, v) => k -> v
end extension

extension (json: Json)
  def toOptionalAny: Option[Any] =
    json match
      case j if j.isNull    => None
      case j if j.isNumber  =>
        j.asNumber.get.toBigDecimal.get match
          case n if n.isValidInt  => Some(n.toInt)
          case n if n.isValidLong => Some(n.toLong)
          case n                  => Some(n.toDouble)
      case j if j.isBoolean => Some(j.asBoolean.get)
      case j if j.isString  => Some(j.asString.get)
      case j if j.isArray   => Some(j.asArray.get)
      case j if j.isObject  => Some(j.asObject.get)
      case j                => Some(j)
end extension
