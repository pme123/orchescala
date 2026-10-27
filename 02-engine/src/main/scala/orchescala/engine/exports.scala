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

/** Removes `_identityCorrelation` (and `_identityCorrelationOfActor`) from variables a caller
  * passes in (start, message, signal, user task completion). Only the engine services set them -
  * signed for the process instance they belong to. Passed through, a correlation copied from
  * another process (logs, variable history) reached the workers as if the engine had set it, and
  * they acted as that user.
  */
def withoutCallerIdentityCorrelation(variables: JsonObject): zio.UIO[JsonObject] =
  val keys    = Seq(
    orchescala.domain.InputParams._identityCorrelation,
    orchescala.domain.InputParams._identityCorrelationPending,
    orchescala.domain.InputParams._identityCorrelationOfActor
  ).map(_.toString)
  val present = keys.filter(variables.contains)
  if present.nonEmpty then
    zio.ZIO
      .logWarning(s"Removed ${present.mkString("`", "`, `", "`")} from the caller's variables - only the engine sets it.")
      .as(present.foldLeft(variables)(_.remove(_)))
  else zio.ZIO.succeed(variables)
end withoutCallerIdentityCorrelation

/** Signs the identity for the process instance it goes into - unsigned (with a warning) when no
  * signing key is configured. The signature does not cover the variable name: copied in the BPMN
  * from `_identityCorrelationOfActor` to `_identityCorrelation`, it stays valid.
  */
def signedFor(
    correlation: orchescala.domain.IdentityCorrelation,
    processInstanceId: String
)(using engineConfig: EngineConfig): zio.UIO[orchescala.domain.IdentityCorrelation] =
  engineConfig.identitySigningKey match
    case Some(key) =>
      zio.ZIO.succeed(orchescala.domain.IdentityCorrelationSigner.sign(correlation, processInstanceId, key))
    case None      =>
      zio.ZIO
        .logWarning("No identity signing key configured - correlation will not be signed")
        .as(correlation.copy(processInstanceId = Some(processInstanceId)))
end signedFor

/** Adds the signed identity of the person who completed the user task or sent the message as
  * `_identityCorrelationOfActor` - `_identityCorrelation` stays as set at the start; a BPMN pattern
  * decides whether the process takes it over.
  */
def withActorIdentity(
    variables: JsonObject,
    signedActor: orchescala.domain.IdentityCorrelation
): JsonObject =
  variables.add(
    orchescala.domain.InputParams._identityCorrelationOfActor.toString,
    signedActor.asJson.deepDropNullValues
  )

/** A message carries the sender's identity (`_identityCorrelationOfActor`) only to a process
  * instance the caller names: the signature needs its id. Correlated by businessKey (or published
  * with a timeToLive) the instance is known only after the correlation - then the message goes
  * without it.
  */
def withActorIdentityOfMessage(
    messageName: String,
    processInstanceId: Option[String],
    identityCorrelation: Option[orchescala.domain.IdentityCorrelation],
    variables: Option[JsonObject]
)(using EngineConfig): zio.UIO[Option[JsonObject]] =
  (identityCorrelation, processInstanceId) match
    case (Some(correlation), Some(pid)) =>
      signedFor(correlation, pid).map: signed =>
        Some(withActorIdentity(variables.getOrElse(JsonObject.empty), signed))
    case (Some(_), None)                =>
      zio.ZIO
        .logInfo(
          s"Message '$messageName' without processInstanceId - sent without `_identityCorrelationOfActor` " +
            "(its signature needs the process instance)."
        )
        .as(variables)
    case _                              => zio.ZIO.succeed(variables)
end withActorIdentityOfMessage

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
