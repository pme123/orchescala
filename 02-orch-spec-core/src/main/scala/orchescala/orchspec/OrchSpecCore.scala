package orchescala.orchspec

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax.*
import orchescala.orchspec.pages.PageDiff

/** The functions of orch-spec-core with JSON in and out - the contract for orch-spec (Scala.js) and for
  * the services of the platform (HTTP). JSON that cannot be read is a `Left` with the reason.
  */
object OrchSpecCore:

  /** `before`, `after`: two pages (orch-spec `Page`) - the differences (`PageChange[]`). */
  def pageDiff(before: String, after: String): Either[String, String] =
    for
      b <- read("before", before)
      a <- read("after", after)
    yield PageDiff(b, a).asJson.noSpaces

  private def read(what: String, json: String): Either[String, Json] =
    parse(json).left.map(e => s"$what is no JSON: ${e.message}")

end OrchSpecCore
