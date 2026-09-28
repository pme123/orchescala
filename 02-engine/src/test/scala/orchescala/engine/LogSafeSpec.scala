package orchescala.engine

import io.circe.{Json, JsonObject}
import orchescala.domain.{GeneralVariables, IdentityCorrelation, JsonProperty}
import zio.test.*

object LogSafeSpec extends ZIOSpecDefault:

  private val customer = JsonObject(
    "name"  -> Json.fromString("Hans Muster"),
    "email" -> Json.fromString("hans@muster.ch"),
    "cif"   -> Json.fromString("4711-0815")
  )

  private case class Out(name: String, email: String)

  private def noPersonalData(logged: String) =
    !logged.contains("Hans") && !logged.contains("hans@muster.ch") && !logged.contains("4711-0815")

  def spec = suite("What a log line shows of process data")(
    test("the names of variables - not their values") {
      val logged = Seq(
        LogSafe.names(customer),
        LogSafe.names(Json.fromJsonObject(customer)),
        LogSafe.names(customer.toMap),
        LogSafe.names(java.util.Map.of("email", "hans@muster.ch")),
        LogSafe.names(Seq(JsonProperty("email", Json.fromString("hans@muster.ch")))),
        LogSafe.names(Out("Hans Muster", "hans@muster.ch")),
        LogSafe.names(Some(Right(Out("Hans Muster", "hans@muster.ch")))),
        LogSafe.names("Hans Muster, hans@muster.ch")
      )
      assertTrue(
        logged.forall(noPersonalData),
        logged.head == "[name, email, cif]",
        LogSafe.names(Out("Hans Muster", "hans@muster.ch")) == "Out(name, email)"
      )
    },
    test("an IdentityCorrelation - also within the GeneralVariables - shows no personal data") {
      val correlation = IdentityCorrelation(
        "hans.muster",
        email = Some("hans@muster.ch"),
        impersonateProcessValue = Some("4711-0815"),
        processInstanceId = Some("pi-1")
      )
      val logged      = Seq(correlation.toString, GeneralVariables(_identityCorrelation = Some(correlation)).toString)
      assertTrue(
        logged.forall(noPersonalData),
        logged.forall(!_.contains("hans.muster")),
        correlation.toString.contains("pi-1") // what is needed to find the process
      )
    }
    ,
    test("an error message: the whole one for the incident, without its details for the log") {
      val message = LogSafe.withDetails("Non-2xx response with code 400", """{"detail":"hans@muster.ch"}""")
      assertTrue(
        message.contains("hans@muster.ch"),
        LogSafe.summary(message) == "Non-2xx response with code 400",
        noPersonalData(LogSafe.forLog(message)),
        LogSafe.forLog(message).contains("full error message is in the incident"),
        LogSafe.forLog("no details") == "no details"
      )
    }
  )
end LogSafeSpec
