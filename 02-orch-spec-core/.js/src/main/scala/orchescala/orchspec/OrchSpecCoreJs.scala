package orchescala.orchspec

import scala.scalajs.js
import scala.scalajs.js.annotation.JSExportTopLevel

/** What orch-spec imports (`src/core/orchSpecCore.ts`, types in `orchSpecCore.d.ts`): JSON text in and
  * out - the same contract as over HTTP. JSON that cannot be read throws an `Error`.
  */
object OrchSpecCoreJs:

  @JSExportTopLevel("pageDiffJson")
  def pageDiffJson(before: String, after: String): String =
    orThrow(OrchSpecCore.pageDiff(before, after))

  private def orThrow(result: Either[String, String]): String =
    result.fold(e => throw js.JavaScriptException(js.Error(e)), identity)

end OrchSpecCoreJs
