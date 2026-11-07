package orchescala.orchspec.pages

import io.circe.{Json, JsonObject}

import scala.annotation.tailrec

/** The key of a building block: its index path in `body` - `"2"`, `"2.1"` (in a section). */
type BlockKey = String

/** A building block with its key and its depth - as the outline of the designer shows it. */
final case class FlatBlock(key: BlockKey, block: JsonObject, depth: Int)

/** The building blocks of a page (orch-spec `pages/runtime/spec.ts`, E15).
  *
  * A page stays JSON: the tools that change it must keep what they do not know (ids, comments,
  * properties of a newer orch-spec) and the order of its keys - like orch-spec, which changes plain
  * objects. The functions here read what they need from it.
  */
object Blocks:

  /** A hand-edited page may lack a list or hold something else where a list belongs - then it is empty. */
  def listOf(value: Option[Json]): Vector[Json] =
    value.flatMap(_.asArray).getOrElse(Vector.empty)

  def typeOf(block: JsonObject): String =
    block("type").flatMap(_.asString).getOrElse("")

  /** Every building block with its key - depth first. A value that is no object is skipped (its index
    * stays taken, so the keys of the others do not move). Without recursion: sections nested however
    * deep do not overflow the stack (on the JVM a StackOverflowError would end the server).
    */
  def flatten(body: Option[Json], prefix: String = ""): Vector[FlatBlock] =
    def entries(list: Option[Json], parent: String): List[(Json, BlockKey)] =
      listOf(list).zipWithIndex.map((json, i) => json -> (if parent.isEmpty then i.toString else s"$parent.$i")).toList

    @tailrec
    def walk(todo: List[(Json, BlockKey)], blocks: Vector[FlatBlock]): Vector[FlatBlock] =
      todo match
        case Nil                 => blocks
        case (json, key) :: rest =>
          json.asObject match
            case None        => walk(rest, blocks)
            case Some(block) =>
              // the depth is the number of parents in the key: "2" 0, "2.1" 1
              val self = FlatBlock(key, block, key.count(_ == '.'))
              val next = if typeOf(block) == "section" then entries(block("body"), key) ++ rest else rest
              walk(next, blocks :+ self)

    walk(entries(body, prefix), Vector.empty)
  end flatten

  /** The text that names a building block - heading, text, label or caption; `""` if it has none. */
  def title(block: JsonObject): String =
    val field = typeOf(block) match
      case "heading" | "text" | "loading" => "text"
      case _                              => "label"
    block(field).flatMap(_.asString).getOrElse("")

  private val typeNames = Map(
    "heading" -> "Überschrift",
    "text"    -> "Text",
    "choice"  -> "Auswahl",
    "pick"    -> "Auswahl aus Liste",
    "fields"  -> "Eingabefelder",
    "summary" -> "Zusammenfassung",
    "button"  -> "Button",
    "section" -> "Abschnitt",
    "loading" -> "Laden"
  )

  /** A building block in words: «Button «Buchen»» - for the differences, the comments, the change log. */
  def name(block: JsonObject): String =
    val tpe   = typeOf(block)
    val kind  = typeNames.getOrElse(tpe, tpe)
    val text  = title(block)
    if text.isEmpty then kind
    else s"$kind «${if text.length > 40 then s"${text.take(40)}…" else text}»"

end Blocks
