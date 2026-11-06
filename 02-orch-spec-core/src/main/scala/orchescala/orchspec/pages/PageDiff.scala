package orchescala.orchspec.pages

import io.circe.{Encoder, Json, JsonObject}
import orchescala.orchspec.Lcs

/** One difference between a page and its draft - what the RE sees before accepting.
  *
  * @param key    the key in the draft - for a removed block the key in the page before
  * @param label  «Eingabefelder «Kontakt»», «Titel»
  * @param detail what changed in detail: «Filiale» neu
  */
final case class PageChange(kind: PageChange.Kind, key: Option[BlockKey], label: String, detail: Option[String])

object PageChange:
  /** `wire`: the name in the JSON - `PageChange.kind` of orch-spec (`core.ts`). */
  enum Kind(val wire: String):
    case added   extends Kind("added")
    case removed extends Kind("removed")
    case changed extends Kind("changed")
    case moved   extends Kind("moved")
    case page    extends Kind("page")

  /** Without the fields that are not there - orch-spec reads them as `undefined`. */
  given Encoder[PageChange] = c =>
    Json.fromFields(
      Seq("kind" -> Json.fromString(c.kind.wire)) ++
        c.key.map("key" -> Json.fromString(_)) ++
        Seq("label" -> Json.fromString(c.label)) ++
        c.detail.map("detail" -> Json.fromString(_))
    )
end PageChange

/** The differences between a page and its draft: building blocks new, changed, moved, removed, and the
  * properties of the page. Building blocks have no ids (their key is the index path), so they are
  * matched by content: the longest common sequence stays, the same block elsewhere has moved, a block
  * of the same type at the same key has changed.
  *
  * Content is compared as JSON text, the keys in their order - as orch-spec did with `JSON.stringify`.
  * The same block with its keys in another order counts as changed, the same state as a change of
  * the page. orch-spec and the platform write pages in one order, so this is no difference in practice.
  *
  * The pairing is a heuristic, taken over unchanged from orch-spec (the RE has seen it since the AI
  * mode): a block with the same type and title has changed; else one at the same key; else - if it
  * is the only one of its type left on both sides - that one (a button with a new label after an
  * insert before it). It reads «changed» where «removed» and «added» would be exact, on purpose: the
  * RE sees one change instead of two.
  */
object PageDiff:
  import PageChange.Kind
  import Blocks.{name, title, typeOf}

  private final case class Flat(key: BlockKey, block: JsonObject, sig: String)

  private val pageProps = Vector(
    "title"  -> "Titel",
    "path"   -> "Pfad",
    "access" -> "Zugang",
    "state"  -> "Anfangszustand",
    "load"   -> "Aktionen beim Laden"
  )

  /** Both pages as JSON - something else than an object counts as an empty page. */
  def apply(before: Json, after: Json): Vector[PageChange] =
    apply(before.asObject.getOrElse(JsonObject.empty), after.asObject.getOrElse(JsonObject.empty))

  def apply(before: JsonObject, after: JsonObject): Vector[PageChange] =
    val props = pageProps.flatMap: (prop, label) =>
      val was = before(prop).getOrElse(Json.Null)
      val now = after(prop).getOrElse(Json.Null)
      Option.when(was.noSpaces != now.noSpaces):
        val detail = Option.when(was.isString || now.isString)(s"«${text(was)}» → «${text(now)}»")
        PageChange(Kind.page, None, label, detail)

    val a       = flat(before)
    val b       = flat(after)
    val common  = Lcs(a.map(_.sig), b.map(_.sig))
    val keptA   = common.map(_._1).toSet
    val keptB   = common.map(_._2).toSet
    val restA   = a.zipWithIndex.collect { case (x, i) if !keptA(i) => x }
    val restB   = b.zipWithIndex.collect { case (x, j) if !keptB(j) => x }
    def sameType(x: Flat)(y: Flat) = typeOf(y.block) == typeOf(x.block)

    // pair the rest: the same content elsewhere has moved, the same type at the same key has changed
    val (changes, left) = restB.foldLeft((Vector.empty[PageChange], restA)):
      case ((changes, left), x) =>
        left.find(_.sig == x.sig) match
          case Some(same) =>
            (changes :+ PageChange(Kind.moved, Some(x.key), name(x.block), Some(s"von ${same.key}")), left.filterNot(_.key == same.key))
          case None =>
            // the same type with the same title (keys shift when something is inserted before), else at the same key
            val was = left.find(y => sameType(x)(y) && title(y.block) == title(x.block))
              .orElse(left.find(y => y.key == x.key && sameType(x)(y)))
              // the only one of its type that is left - a button with a new label after an insert before it
              .orElse(if left.count(sameType(x)) == 1 && restB.count(sameType(x)) == 1 then left.find(sameType(x)) else None)
            was match
              case Some(old) =>
                (changes :+ PageChange(Kind.changed, Some(x.key), name(x.block), detailOf(old.block, x.block)), left.filterNot(_.key == old.key))
              case None =>
                (changes :+ PageChange(Kind.added, Some(x.key), name(x.block), None), left)

    props ++ changes ++ left.map(y => PageChange(Kind.removed, Some(y.key), name(y.block), None))
  end apply

  /** The keys in the draft that are new, changed or moved - the outline marks them. */
  def changedKeys(changes: Seq[PageChange]): Set[BlockKey] =
    changes.filter(c => c.kind != Kind.removed && c.kind != Kind.page).flatMap(_.key).toSet

  private def flat(page: JsonObject): Vector[Flat] =
    Blocks.flatten(page("body")).map(f => Flat(f.key, f.block, signature(f.block)))

  /** A block without the content of a section - a section with a changed child has not changed itself. */
  private def signature(block: JsonObject): String =
    Json.fromJsonObject(block.remove("body")).noSpaces

  /** What changed in a fields block, a summary or a choice - the labels of the entries. */
  private def detailOf(before: JsonObject, after: JsonObject): Option[String] =
    def entries(b: JsonObject): Option[Vector[String]] =
      val list = typeOf(b) match
        case "fields"  => Some("fields")
        case "summary" => Some("items")
        case "choice"  => Some("options")
        case _         => None
      list.map(l => Blocks.listOf(b(l)).map(_.asObject.flatMap(_("label")).flatMap(_.asString).getOrElse("")))
    for
      was  <- entries(before)
      now  <- entries(after)
      parts = now.filterNot(was.contains).map(l => s"«$l» neu") ++ was.filterNot(now.contains).map(l => s"«$l» entfernt")
      if parts.nonEmpty
    yield parts.mkString(", ")
  end detailOf

  /** A value of a property as text: a text itself, nothing as empty. */
  private def text(value: Json): String =
    value.asString.getOrElse(if value.isNull then "" else value.noSpaces)

end PageDiff
