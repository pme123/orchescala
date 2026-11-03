package orchescala.helper.dev.update.merge

import io.circe.{Decoder, Encoder, Json}
import io.circe.syntax.*

/** Where a spec comes from - a folder (what Orch Spec sent) or the project's `spec/` in a commit. */
enum SpecSource:
  /** a spec folder, e.g. what Orch Spec sent - or the project's own `spec/` */
  case Dir(path: os.Path)
  /** the project's `spec/` in a commit, e.g. `HEAD` */
  case GitRev(rev: String)
  /** no spec - the first export of a project (nothing before), or a process removed as a whole */
  case Empty

/** Who a file belongs to. */
enum Owner:
  /** `spec/` - Orch Spec's: taken over as it is, deleted too */
  case spec
  /** created from the export - afterwards developers change it too: 3-way merge */
  case generated
  /** entries in the `WorkerApp` and the `ApiProjectCreator` - added and removed */
  case registration

enum Action:
  case create, update, merged, delete, unchanged, conflict

/** A conflict in a file: the line in the code, what the spec and what the code has there. */
case class Conflict(line: Int, spec: String, code: String)

/** One file of the plan.
  * @param codeHash hash of the file in the project at the check - None if it does not exist
  * @param content  what `merge` writes: the new content (create, update, merged) - for a conflict
  *                 the content with conflict markers (`OnConflict.Markers`)
  * @param note     why - e.g. «removed in orch-spec, changed in the code»
  */
case class PlannedFile(
    path: String,
    owner: Owner,
    action: Action,
    codeHash: Option[String] = None,
    content: Option[String] = None,
    conflicts: Seq[Conflict] = Seq.empty,
    note: Option[String] = None,
    // `content` is base64 - a file of the spec that is no text (a logo of a theme)
    binary: Boolean = false
)

/** What `merge` will do - decided by `checkMerge`, executed as it is (nothing is recomputed).
  * @param notes what the check found besides the files (a process of another project, a worker
  *              that exists elsewhere, an export issue …)
  */
case class MergePlan(project: String, files: Seq[PlannedFile], notes: Seq[String] = Seq.empty):

  lazy val summary: Map[Action, Int] =
    Action.values.map(a => a -> files.count(_.action == a)).toMap

  def withAction(action: Action): Seq[PlannedFile] = files.filter(_.action == action)

  def hasConflicts: Boolean = files.exists(_.action == Action.conflict)

  /** Something to write or delete - with `KeepCode` the conflicts stay as they are. */
  def hasChanges: Boolean = files.exists(f => !Seq(Action.unchanged, Action.conflict).contains(f.action))

  def toJson: Json = this.asJson
  def toJsonString: String = toJson.spaces2

end MergePlan

object MergePlan:

  given Encoder[Owner]  = Encoder.encodeString.contramap(_.toString)
  given Decoder[Owner]  = Decoder.decodeString.emapTry(s => scala.util.Try(Owner.valueOf(s)))
  given Encoder[Action] = Encoder.encodeString.contramap(_.toString)
  given Decoder[Action] = Decoder.decodeString.emapTry(s => scala.util.Try(Action.valueOf(s)))

  given Encoder[Conflict] = c => Json.obj("line" -> c.line.asJson, "spec" -> c.spec.asJson, "code" -> c.code.asJson)
  given Decoder[Conflict] = c =>
    for
      line <- c.get[Int]("line")
      spec <- c.get[String]("spec")
      code <- c.get[String]("code")
    yield Conflict(line, spec, code)

  given Encoder[PlannedFile] = f =>
    Json.obj(
      Seq("path" -> f.path.asJson, "owner" -> f.owner.asJson, "action" -> f.action.asJson) ++
        f.codeHash.map("codeHash" -> _.asJson) ++
        Option.when(f.conflicts.nonEmpty)("conflicts" -> f.conflicts.asJson) ++
        f.note.map("note" -> _.asJson) ++
        Option.when(f.binary)("encoding" -> "base64".asJson) ++
        f.content.map("content" -> _.asJson)*
    )
  given Decoder[PlannedFile] = c =>
    for
      path      <- c.get[String]("path")
      owner     <- c.get[Owner]("owner")
      action    <- c.get[Action]("action")
      codeHash  <- c.get[Option[String]]("codeHash")
      content   <- c.get[Option[String]]("content")
      conflicts <- c.get[Option[Seq[Conflict]]]("conflicts")
      note      <- c.get[Option[String]]("note")
      encoding  <- c.get[Option[String]]("encoding")
    yield PlannedFile(path, owner, action, codeHash, content, conflicts.getOrElse(Seq.empty), note, encoding.contains("base64"))

  given Encoder[MergePlan] = p =>
    Json.obj(
      "project" -> p.project.asJson,
      "files"   -> p.files.asJson,
      "summary" -> Json.obj(Action.values.toSeq.map(a => a.toString -> p.summary(a).asJson)*),
      "notes"   -> p.notes.asJson
    )
  given Decoder[MergePlan] = c =>
    for
      project <- c.get[String]("project")
      files   <- c.get[Seq[PlannedFile]]("files")
      notes   <- c.get[Option[Seq[String]]]("notes")
    yield MergePlan(project, files, notes.getOrElse(Seq.empty))

  def fromJson(text: String): MergePlan =
    io.circe.parser.decode[MergePlan](text).fold(e => throw IllegalArgumentException(s"Not a merge plan: ${e.getMessage}"), identity)

end MergePlan

/** What to do with a conflict. */
enum OnConflict:
  /** the file stays as it is - the conflicts are in the result */
  case KeepCode
  /** the file gets conflict markers like `git merge` - the developer resolves them in the IDE */
  case Markers

/** What `merge` did. */
case class MergeResult(written: Seq[String], deleted: Seq[String], conflicts: Seq[PlannedFile])

/** A file changed between the check and the merge - nothing was written; it needs a new check. */
case class MergeAborted(changed: Seq[String])
    extends RuntimeException(s"Changed since the check - nothing written, check again: ${changed.mkString(", ")}")

/** The merge stopped at a file (an IO error): what was written and deleted before it stays, the
  * files after it were not touched. Fix the cause and merge again - the files already merged are
  * unchanged in the new plan.
  * @param done   what was written and deleted before
  * @param failed the file it stopped at
  */
case class MergeIncomplete(done: MergeResult, failed: String, cause: Throwable)
    extends RuntimeException(
      s"The merge stopped at $failed (${MergeIncomplete.reason(cause)}) - ${done.written.size} file(s) written and ${done.deleted.size} deleted before it.",
      cause
    )

object MergeIncomplete:
  /** Why it stopped - the exception itself if it has no message (an NPE, some IO errors). */
  def reason(cause: Throwable): String = Option(cause.getMessage).getOrElse(cause.toString)
