package orchescala.helper.dev.update.merge

import orchescala.helper.dev.update.*

import java.nio.charset.{CharacterCodingException, CodingErrorAction, StandardCharsets}
import java.security.MessageDigest
import scala.util.control.NonFatal
import scala.util.{Failure, Success, Try}

/** The merge from Orch Spec - all changes of the spec reach the code without losing the
  * implementation. Two steps: first check (`checkMerge` gives the plan, writes nothing), then
  * execute exactly the plan (`merge`). No output, no questions - the CLI prints the plan.
  *
  * The base is the export of the spec before the change (`GitRev("HEAD")`: the spec is in the
  * repository), so no copy of the last export is kept. Base, new and code are compared per file
  * of the project:
  *
  * | base -> new   | code                       | action                                   |
  * |---------------|----------------------------|------------------------------------------|
  * | added         | missing                    | create                                   |
  * | added         | exists, same               | unchanged                                |
  * | added         | exists, different          | 3-way with an empty base (mostly conflict)|
  * | changed       | = base                     | update                                   |
  * | changed       | changed elsewhere          | merged                                   |
  * | changed       | changed at the same place  | conflict                                 |
  * | unchanged     | any                        | unchanged - the developer's change stays |
  * | removed       | = base                     | delete                                   |
  * | removed       | changed                    | conflict                                 |
  *
  * Exceptions: the files of `spec/` are taken over 1:1 (deleted too); the registrations are added
  * and removed in the `WorkerApp` and the `ApiProjectCreator`; a skeleton (worker, template BPMN)
  * that exists without a base stays; the process object without a base gets the types of Orch
  * Spec merged by structure (as `processFromSpec` always did). BPMN and DMN are brought into one
  * form first: as the Camunda Modeler writes them (Orch Spec's `modelerXml`) - indentation and the
  * order of attributes are no change, and a file the Modeler saved stays as it is -
  * and their diagram (coordinates) is merged apart from the logic (`DiagramMerge`).
  */
object SpecMerge:

  /** 1. Check: the plan for the change of the spec from `before` to `after` - writes nothing.
    * @param exporter the export of a spec folder - Orch Spec's tool with Node.js by default
    */
  def checkMerge(
      project: os.Path,
      before: SpecSource,
      after: SpecSource,
      exporter: SpecExporter = NodeSpecExporter,
      formatter: XmlFormatter = XmlFormatter.default
  )(using DevConfig): MergePlan =
    val beforeDir = SpecSources.folder(project, before)
    val afterDir  = SpecSources.folder(project, after)
    val notes     = Seq.newBuilder[String]
    if after != SpecSource.Empty && afterDir.isEmpty then
      throw IllegalArgumentException(s"No spec in $after.")
    val base      = beforeDir.fold(SpecExport.empty)(exporter.exportOf)
    val neu       = afterDir.fold(SpecExport.empty)(exporter.exportOf)
    notes ++= neu.issues
    // the spec in the project is taken over as Orch Spec sent it - not if it is the project's own
    val specFiles = afterDir.map(SpecSources.files)
    try plan(project, base.entries, neu.entries, specFiles, notes.result(), formatter = formatter)
    finally
      // a commit was extracted into a temporary folder
      if before.isInstanceOf[SpecSource.GitRev] then beforeDir.foreach(os.remove.all)
      if after.isInstanceOf[SpecSource.GitRev] then afterDir.foreach(os.remove.all)
  end checkMerge

  /** The plan from the exports of the processes and services before and after.
    * @param specFiles the files of the new spec folder (relative to it) - None: `spec/` stays as it is
    * @param strict    a process that cannot be planned is an error (one process from `orchspec:`) -
    *                  otherwise a note and the process is left out
    * @param formatter brings the BPMN and DMN of base, new and code into the Modeler's form before they are
    *                  compared - a file that differs only in its form is unchanged; what is written
    *                  is formatted
    */
  def plan(
      project: os.Path,
      before: Seq[SpecEntry],
      after: Seq[SpecEntry],
      specFiles: Option[Map[os.RelPath, Array[Byte]]] = None,
      notes: Seq[String] = Seq.empty,
      strict: Boolean = false,
      formatter: XmlFormatter = XmlFormatter.default
  )(using config: DevConfig): MergePlan =
    val processes = ProcessPlanner(project)
    val services  = ServicePlanner(project)
    val messages  = Seq.newBuilder[String] ++= notes
    def planned(exports: Seq[SpecEntry], which: String) =
      exports.flatMap: e =>
        val files = e match
          case p: ProcessExport  => Try(processes.plan(p))
          case s: ServicesExport => Try(services.plan(s))
        files match
          case Success(files)                   => Some(e.slug -> files)
          case Failure(ex) if strict            => throw ex
          case Failure(ex)                      =>
            messages += s"${e.slug}$which: ${ex.getMessage} - left out."
            None
    val basePlanned = planned(before, " (before)")
    val newPlanned  = planned(after, "")
    val base        = basePlanned.map(_._2)
    val neu         = newPlanned.map(_._2)
    messages ++= neu.flatMap(_.notes)

    // a file two entries give is taken from the first - if they give it with different contents,
    // a note (for the new export: that is what is written)
    def byPath(planned: Seq[(String, ProcessFiles)], note: Boolean): Map[os.RelPath, GeneratedFile] =
      planned.flatMap((slug, p) => p.files.map(slug -> _)).groupBy(_._2.rel).toSeq.sortBy(_._1.toString).map:
        (rel, all) =>
          val (first, file) = all.head
          val others        = all.tail.filterNot((_, f) => same(f.content, file.content)).map(_._1).distinct
          if note && others.nonEmpty then
            messages += s"$rel: ${(first +: others).mkString(", ")} give it with different contents - the one of $first is taken."
          rel -> file
      .toMap
    val baseFiles = byPath(basePlanned, note = false)
    val newFiles  = byPath(newPlanned, note = true)
    val rels      = (baseFiles.keySet ++ newFiles.keySet).toSeq.sortBy(_.toString)
    // BPMN and DMN: the three sides in the Modeler's form - in one run of the formatter
    val xml       = rels.filter(isXml).flatMap: rel =>
      baseFiles.get(rel).map(f => s"base:$rel" -> f.content) ++
        newFiles.get(rel).map(f => s"new:$rel" -> f.content) ++
        read(project / rel).map(c => s"code:$rel" -> c)
    val formatted = if xml.isEmpty then Map.empty[String, String] else formatter.format(xml.toMap)
    def form(side: String, rel: os.RelPath)(text: String) = formatted.getOrElse(s"$side:$rel", text)
    val generated = rels.flatMap: rel =>
      decide(
        rel,
        baseFiles.get(rel).map(f => f.copy(content = form("base", rel)(f.content))),
        newFiles.get(rel).map(f => f.copy(content = form("new", rel)(f.content))),
        read(project / rel).map(form("code", rel)),
        hashOf(project / rel)
      )

    // a collection and an orchestration of the same API give the same block - one with the entries of both
    def joined(files: Seq[ProcessFiles], file: os.RelPath): Seq[OrchSpecRegistration] =
      val all = files.flatMap(_.registrations).filter(_.file == file).map(_.registration)
      all.map(_.name).distinct.map: name =>
        val same = all.filter(_.name == name)
        same.head.copy(entries = same.flatMap(_.entries).distinct)
    val registrations = (base ++ neu).flatMap(_.registrations).map(_.file).distinct.sortBy(_.toString).flatMap: file =>
      register(
        file,
        joined(base, file),
        joined(neu, file),
        read(project / file),
        hashOf(project / file)
      )

    val spec = specFiles.toSeq.flatMap(files => takeOver(project, files))
    MergePlan(config.projectName, generated ++ registrations ++ spec, messages.result().distinct)
  end plan

  /** 2. Merge: exactly the plan - first all `codeHash` are checked: if a file changed since the
    * check, it aborts without writing a file (`MergeAborted`). If writing or deleting a file fails,
    * it stops there - `MergeIncomplete` tells what was done before.
    */
  def merge(project: os.Path, plan: MergePlan, onConflict: OnConflict): MergeResult =
    val changed = plan.files.filter(f => hashOf(project / os.RelPath(f.path)) != f.codeHash).map(_.path)
    if changed.nonEmpty then throw MergeAborted(changed)
    val written = Seq.newBuilder[String]
    val deleted = Seq.newBuilder[String]
    def write(f: PlannedFile) = f.content.foreach: content =>
      val bytes = if f.binary then java.util.Base64.getDecoder.decode(content) else content.getBytes(StandardCharsets.UTF_8)
      os.write.over(project / os.RelPath(f.path), bytes, createFolders = true)
      written += f.path
    def result = MergeResult(written.result(), deleted.result(), plan.withAction(Action.conflict))
    plan.files.foreach: f =>
      try
        f.action match
          case Action.create | Action.update | Action.merged => write(f)
          case Action.delete                                 =>
            os.remove(project / os.RelPath(f.path))
            deleted += f.path
          case Action.conflict if onConflict == OnConflict.Markers => write(f)
          case _                                             => ()
      catch case NonFatal(e) => throw MergeIncomplete(result, f.path, e)
    result
  end merge

  // ── deciding ────────────────────────────────────────────────────────────────────────────

  private val removedInSpec  = "in orch-spec entfernt, im Code geändert"
  private val deletedInCode  = "im Code gelöscht, in orch-spec geändert"

  /** One generated file: base and new export against the code - see the table above. */
  private[merge] def decide(
      rel: os.RelPath,
      base: Option[GeneratedFile],
      neu: Option[GeneratedFile],
      code: Option[String],
      hash: Option[String]
  ): Option[PlannedFile] =
    def file(action: Action, content: Option[String] = None, conflicts: Seq[Conflict] = Seq.empty, note: Option[String] = None) =
      Some(PlannedFile(rel.toString, Owner.generated, action, hash, content, conflicts, note))
    // BPMN and DMN: the logic as text, the diagram (shapes, edges) entry by entry - see DiagramMerge
    def threeWay(b: String, c: String, n: String) =
      val diagram    = if isXml(rel) && b.nonEmpty then DiagramMerge.merge(b, c, n) else None
      val (r, notes) = diagram.fold(ThreeWay.merge(b, c, n) -> Seq.empty[String])(d => d.merge -> d.notes)
      val note       = Option.when(notes.nonEmpty)(notes.mkString("; "))
      if r.clean then file(Action.merged, Some(r.text), note = note)
      else file(Action.conflict, Some(r.text), r.conflicts, note)
    (base, neu, code) match
      case (None, None, _) | (Some(_), None, None) => None
      case (None, Some(n), None)        => file(Action.create, Some(n.content))
      case (Some(b), None, Some(c))     =>
        // the simulation follows the code - its process is gone: compared with the skeleton
        if same(c, b.pristine.getOrElse(b.content)) then file(Action.delete)
        else file(Action.conflict, conflicts = Seq(Conflict(1, "", firstLines(c))), note = Some(removedInSpec))
      case (Some(b), Some(n), None)     =>
        // the developer deleted it - that stays, unless Orch Spec changed it
        if same(b.content, n.content) then file(Action.unchanged, note = Some("im Code gelöscht"))
        else file(Action.conflict, Some(n.content), Seq(Conflict(1, firstLines(n.content), "")), Some(deletedInCode))
      case (None, Some(n), Some(c))     =>
        if same(c, n.content) then file(Action.unchanged)
        else
          n.kind match
            case FileKind.Simulation    => file(Action.update, Some(n.content))
            case FileKind.Scaffold      => file(Action.unchanged, note = Some("existiert - einmal erzeugt, bleibt"))
            case FileKind.ProcessObject =>
              val merged = n.structural.fold(c)(_(c))
              if same(merged, c) then file(Action.unchanged) else file(Action.merged, Some(merged))
            case FileKind.Export        => threeWay("", c, n.content)
      case (Some(b), Some(n), Some(c))  =>
        if n.kind == FileKind.Simulation then
          if same(c, n.content) then file(Action.unchanged) else file(Action.update, Some(n.content))
        else if same(b.content, n.content) || same(c, n.content) then file(Action.unchanged)
        else if same(c, b.content) then file(Action.update, Some(n.content))
        else threeWay(b.content, c, n.content)
    end match
  end decide

  /** The registrations in one file: those of the new export added, those the base had and the new
    * one does not removed - an entry, or the block of a process that is gone.
    */
  private[merge] def register(
      file: os.RelPath,
      base: Seq[OrchSpecRegistration],
      neu: Seq[OrchSpecRegistration],
      code: Option[String],
      hash: Option[String]
  ): Option[PlannedFile] =
    def planned(action: Action, content: Option[String] = None, conflicts: Seq[Conflict] = Seq.empty, note: Option[String] = None) =
      Some(PlannedFile(file.toString, Owner.registration, action, hash, content, conflicts, note))
    code match
      case None           =>
        if !neu.exists(_.entries.nonEmpty) then None
        else
          planned(
            Action.conflict,
            conflicts = neu.map(r => Conflict(0, r.snippet(r.entries), "")),
            note = Some(s"$file does not exist - add the registrations by hand")
          )
      case Some(existing) =>
        val manual  = Seq.newBuilder[(String, String)]
        val added   = neu.foldLeft(existing): (content, r) =>
          r.register(content) match
            case RegistrationResult.Registered(next, _)     => next
            case RegistrationResult.Unchanged               => content
            case RegistrationResult.Manual(reason, snippet) =>
              manual += reason -> snippet
              content
        val removed = base.foldLeft(added): (content, b) =>
          neu.find(_.name == b.name) match
            case None    => b.unregister(content, Seq.empty, wholeBlock = true)
            case Some(n) =>
              val gone = b.entries.filterNot(n.entries.contains)
              if gone.isEmpty then content else n.unregister(content, gone, wholeBlock = false)
        val todo    = manual.result()
        if todo.nonEmpty then
          planned(
            Action.conflict,
            Option.when(removed != existing)(removed),
            todo.map((_, snippet) => Conflict(0, snippet, "")),
            Some(todo.map(_._1).mkString(" "))
          )
        else if removed == existing then planned(Action.unchanged)
        else planned(Action.merged, Some(removed))
        end if
    end match
  end register

  /** `spec/` as Orch Spec sent it - 1:1, without merge; what is no longer there is deleted. */
  private def takeOver(project: os.Path, files: Map[os.RelPath, Array[Byte]]): Seq[PlannedFile] =
    val dir   = project / SpecSources.specDir
    val code  = SpecSources.files(dir)
    val paths = (files.keySet ++ code.keySet).toSeq.sortBy(_.toString)
    paths.flatMap: rel =>
      val path = (SpecSources.specDir / rel).toString
      val hash = code.get(rel).map(sha256)
      (files.get(rel), code.get(rel)) match
        case (Some(n), c) =>
          val (content, binary) = text(n).fold(java.util.Base64.getEncoder.encodeToString(n) -> true)(_ -> false)
          val action            = c match
            case None                                => Action.create
            case Some(bytes) if bytes.sameElements(n) => Action.unchanged
            case Some(_)                             => Action.update
          Some(PlannedFile(path, Owner.spec, action, hash, Option.when(action != Action.unchanged)(content), binary = binary))
        case (None, Some(_)) => Some(PlannedFile(path, Owner.spec, Action.delete, hash))
        case (None, None)    => None
  end takeOver

  // ── helpers ───────────────────────────────────────────────────────────────────────────────

  private def read(file: os.Path): Option[String] = Option.when(os.isFile(file))(os.read(file))

  private def isXml(rel: os.RelPath): Boolean = Seq("bpmn", "dmn").contains(rel.ext)

  /** Equal if they differ only in blanks at the line ends and empty lines at the end. */
  private def same(a: String, b: String): Boolean =
    OrchSpecExport.normalized(a) == OrchSpecExport.normalized(b)

  private def firstLines(text: String): String = text.linesIterator.take(5).mkString("\n")

  /** UTF-8 text - or None (binary). */
  private def text(bytes: Array[Byte]): Option[String] =
    try
      Some(
        StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(java.nio.ByteBuffer.wrap(bytes))
          .toString
      )
    catch case _: CharacterCodingException => None

  /** SHA-256 of the file - None if it does not exist. */
  def hashOf(file: os.Path): Option[String] =
    Option.when(os.isFile(file))(sha256(os.read.bytes(file)))

  private def sha256(bytes: Array[Byte]): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).map("%02x".format(_)).mkString

end SpecMerge
