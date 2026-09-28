package orchescala.engine

import io.circe.{Json, JsonObject}
import orchescala.domain.JsonProperty

import scala.jdk.CollectionConverters.*

/** What a log line may show of process data: its names (keys, fields, sizes) - never the values.
  *
  * Variables, inputs, outputs and bodies hold personal data (CID, email addresses) - they were in
  * the log, on INFO or DEBUG.
  */
object LogSafe:

  def names(value: Any): String =
    value match
      case null                                   => "null"
      case json: Json                             =>
        json.asObject.map(o => keys(o.keys))
          .orElse(json.asArray.map(a => s"array(${a.size})"))
          .getOrElse(if json.isNull then "null" else "value")
      case obj: JsonObject                        => keys(obj.keys)
      case map: Map[?, ?]                         => keys(map.keys.map(_.toString))
      case map: java.util.Map[?, ?]               => keys(map.keySet.asScala.map(_.toString))
      case prop: JsonProperty                     => prop.key
      case opt: Option[?]                         => opt.fold("None")(v => s"Some(${names(v)})")
      case either: Either[?, ?]                   => either.fold(l => s"Left(${names(l)})", r => s"Right(${names(r)})")
      case seq: Iterable[?]                       => seq.map(names).mkString("[", ", ", "]")
      case s: String                              => s"<${s.length} characters>"
      case p: Product if p.productArity > 0       => s"${p.productPrefix}(${p.productElementNames.mkString(", ")})"
      case p: Product                             => p.productPrefix
      case other                                  => s"<${other.getClass.getSimpleName}>"

  private def keys(keys: Iterable[String]): String = keys.mkString("[", ", ", "]")

  /** Separates the details of an error message (a response body, variables): the whole message
    * goes into the incident (Cockpit / Operate) - needed to fix the error - the log gets the part
    * before it.
    */
  val detailsSeparator = "\n--- Details ---\n"

  def withDetails(summary: String, details: String): String = s"$summary$detailsSeparator$details"

  /** The error message without its details. */
  def summary(message: String): String =
    message.indexOf(detailsSeparator) match
      case -1    => message
      case index => message.take(index)

  /** The error message for a log line - its details left out, with where to find them, and the
    * values quoted by a decoding error masked.
    */
  def forLog(message: String, fullMessageIn: String = "in the incident (Cockpit / Operate)"): String =
    message.indexOf(detailsSeparator) match
      case -1    => withoutQuotedValues(message)
      case index =>
        s"${withoutQuotedValues(message.take(index))} [details left out - the full error message is $fullMessageIn]"

  // circe quotes the value that could not be decoded / parsed - e.g. a name where a number is due
  private val wrongTypeValue = """Got value '.*?' with wrong type""".r
  private val parsedValue    = """(expected [^']*? got) '.*?'""".r

  private def withoutQuotedValues(message: String): String =
    parsedValue.replaceAllIn(
      wrongTypeValue.replaceAllIn(message, "Got a value with wrong type"),
      m => scala.util.matching.Regex.quoteReplacement(s"${m.group(1)} '***'")
    )

end LogSafe
