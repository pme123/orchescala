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
