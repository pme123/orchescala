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
  * The Scala files of the export (the domain classes) are merged into the code by structure - the
  * code is the basis, whatever the spec was before (`ScalaMerge`): what Orch Spec generates comes
  * in, the own implementation stays, and what only the code has (classes, objects, cases of an
  * enum - or a whole file of them next to the generated ones) is a `Removal`: it goes only when
  * the developer says so (`merge` with `remove`). The process object is merged by structure too.
  *
  * For the other files the base is the export of the spec before the change (`GitRev("HEAD")`: the
  * spec is in the repository), so no copy of the last export is kept. Base, new and code are
  * compared per file of the project:
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
    // a commit is extracted into a temporary folder - removed whatever fails after it
    def extracted[A](source: SpecSource)(use: Option[os.Path] => A): A =
      val dir = SpecSources.folder(project, source)
      try use(dir)
      finally if source.isInstanceOf[SpecSource.GitRev] then dir.foreach(os.remove.all)
    extracted(before): beforeDir =>
      extracted(after): afterDir =>
        if after != SpecSource.Empty && afterDir.isEmpty then
          throw IllegalArgumentException(s"No spec in $after.")
        val base      = beforeDir.fold(SpecExport.empty)(exporter.exportOf)
        val neu       = afterDir.fold(SpecExport.empty)(exporter.exportOf)
        // the spec in the project is taken over as Orch Spec sent it - not if it is the project's own
        val specFiles = afterDir.map(SpecSources.files)
        plan(project, base.entries, neu.entries, specFiles, neu.issues, formatter = formatter)
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

    // a file several processes give: the first one is taken - noted only for the new export, the
    // one that is written; the base only decides what changed
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
    MergePlan(config.projectName, generated ++ orphans(project, newFiles.values.toSeq, rels.toSet) ++ registrations ++ spec, messages.result().distinct)
  end plan

  /** 2. Merge: exactly the plan - first all `codeHash` are checked: if a file changed since the
    * check, it aborts without writing a file (`MergeAborted`). If writing or deleting a file fails,
    * it stops there - `MergeIncomplete` tells what was done before.
    * @param remove the files whose removal applies - what only the code has goes there (the
    *               developer said so, `MergeReport.askRemoval`); elsewhere it stays
    */
  def merge(project: os.Path, plan: MergePlan, onConflict: OnConflict, remove: Set[String] = Set.empty): MergeResult =
    val changed = plan.files.filter(f => hashOf(project / os.RelPath(f.path)) != f.codeHash).map(_.path)
    if changed.nonEmpty then throw MergeAborted(changed)
    val written = Seq.newBuilder[String]
    val deleted = Seq.newBuilder[String]
    def write(f: PlannedFile) = f.content.foreach: content =>
      val bytes = if f.binary then java.util.Base64.getDecoder.decode(content) else content.getBytes(StandardCharsets.UTF_8)
      val path   = project / os.RelPath(f.path)
      // a link stays a link: the file it points to is written; one pointing nowhere is written through
      val linked = if os.isLink(path) then os.followLink(path) else Some(path)
      if linked.isEmpty then os.write.over(path, bytes)
      else
        val target = linked.get
        // written next to it (a name of its own) and moved in place: a write that fails leaves
        // the file as it was; an existing file keeps its permissions (an executable script stays
        // executable) - where the file system has them
        // (os.write, not os.temp: a new file gets the usual permissions, not the owner's only)
        val temp = target / os.up / s".${target.last}.${java.util.UUID.randomUUID()}.merging"
        try
          os.write(temp, bytes, createFolders = true)
          if os.exists(target) then Try(os.perms.set(temp, os.perms(target)))
          // a file system without an atomic move: moved all the same
          try os.move(temp, target, replaceExisting = true, atomicMove = true)
          catch case _: java.nio.file.AtomicMoveNotSupportedException => os.move(temp, target, replaceExisting = true)
        finally Try(os.remove(temp))
      end if
      written += f.path
    val removed   = Seq.newBuilder[String]
    val removedIn = Seq.newBuilder[String]
    def result    = MergeResult(written.result(), deleted.result(), plan.withAction(Action.conflict), removed.result(), removedIn.result())
    def planned(f: PlannedFile): Unit = f.action match
      case Action.create | Action.update | Action.merged       => write(f)
      case Action.delete                                       =>
        os.remove(project / os.RelPath(f.path))
        deleted += f.path
      case Action.conflict if onConflict == OnConflict.Markers => write(f)
      case _                                                   => ()
    plan.files.foreach: f =>
      try
        // only on a file that is merged or stays - a conflict is never written over by it
        f.removal.filter(_ => remove(f.path) && Seq(Action.unchanged, Action.merged).contains(f.action)) match
          // what only the code has - the developer said it goes
          case Some(Removal(names, None))          =>
            os.remove(project / os.RelPath(f.path))
            deleted += f.path
            removed ++= names
            removedIn += f.path
          case Some(Removal(names, Some(content))) =>
            write(f.copy(content = Some(content), binary = false))
            removed ++= names
            removedIn += f.path
          case None                                => planned(f)
      catch case NonFatal(e) => throw MergeIncomplete(result, f.path, e)
    result
  end merge

  // ── deciding ────────────────────────────────────────────────────────────────────────────

  private val removedInSpec  = "removed in orch-spec, changed in the code"
  private val deletedInCode  = "deleted in the code, changed in orch-spec"

  /** One generated file: base and new export against the code - see the table above. */
  private[merge] def decide(
      rel: os.RelPath,
      base: Option[GeneratedFile],
      neu: Option[GeneratedFile],
      code: Option[String],
      hash: Option[String]
  ): Option[PlannedFile] =
    def file(
        action: Action,
        content: Option[String] = None,
        conflicts: Seq[Conflict] = Seq.empty,
        note: Option[String] = None,
        removal: Option[Removal] = None
    ) =
      Some(PlannedFile(rel.toString, Owner.generated, action, hash, content, conflicts, note, removal = removal))
    // a Scala file of the export: by structure into the code - the code is the basis
    // code it does not read (tabs, braces) or a result whose brackets do not close: as text, like
    // git - what differs is a conflict, nothing of the code is lost unseen
    def intoCode(c: String, n: String) =
      if same(c, n) then file(Action.unchanged)
      else if !ScalaMerge.readable(c) then asText(c, n, "not in the form the structural merge reads (tabs or braces)")
      else
        val r       = ScalaMerge.merge(c, n)
        val removal = Option.when(r.removable.nonEmpty)(Removal(r.removable, Some(r.without)))
        if !ScalaMerge.balanced(r.text) || !ScalaMerge.balanced(r.without) then asText(c, n, "the structural merge did not close its brackets")
        else if same(r.text, c) then file(Action.unchanged, note = Option.when(removal.isEmpty)("only the form differs"), removal = removal)
        else file(Action.merged, Some(r.text), removal = removal)
    def asText(c: String, n: String, why: String) =
      val r = ThreeWay.merge("", c, n, ignoreForm = true)
      if r.clean then file(Action.merged, Some(r.text), note = Some(s"merged as text - $why"))
      else file(Action.conflict, Some(r.text), r.conflicts, Some(s"merged as text - $why"))
    def structural(f: GeneratedFile) = f.kind == FileKind.Export && rel.ext == "scala"
    def processObject(n: GeneratedFile, c: String) =
      val merged = n.structural.fold(c)(_(c))
      if same(merged, c) then file(Action.unchanged) else file(Action.merged, Some(merged))
    // BPMN and DMN: the logic as text, the diagram (shapes, edges) entry by entry - see DiagramMerge
    def threeWay(b: String, c: String, n: String) =
      val diagram    = if isXml(rel) && b.nonEmpty then DiagramMerge.merge(b, c, n) else None
      // the form is no change only in Scala - in YAML or Markdown the indentation is meaning
      val scala      = rel.ext == "scala"
      val (r, notes) = diagram.fold(ThreeWay.merge(b, c, n, ignoreForm = scala) -> Seq.empty[String])(d => d.merge -> d.notes)
      val note       = Option.when(notes.nonEmpty)(notes.mkString("; "))
      if r.clean then
        // what only differs in its form stays as the code has it
        if scala && same(r.text, c) then file(Action.unchanged, note = note.orElse(Some("only the form differs")))
        else file(Action.merged, Some(r.text), note = note)
      else file(Action.conflict, Some(r.text), r.conflicts, note)
    (base, neu, code) match
      case (None, None, _) | (Some(_), None, None) => None
      case (_, Some(n), None) if structural(n)     => file(Action.create, Some(n.content))
      case (_, Some(n), Some(c)) if structural(n)  => intoCode(c, n.content)
      case (_, Some(n), Some(c)) if n.kind == FileKind.ProcessObject => processObject(n, c)
      case (Some(b), None, Some(c)) if structural(b) =>
        // Orch Spec no longer gives it - its classes go only when the developer says so
        file(Action.unchanged, note = Some("not in orch-spec any more"), removal = orphaned(c))
      case (None, Some(n), None)        => file(Action.create, Some(n.content))
      case (Some(b), None, Some(c))     =>
        // the simulation follows the code - its process is gone: compared with the skeleton
        if same(c, b.pristine.getOrElse(b.content)) then file(Action.delete)
        else file(Action.conflict, conflicts = Seq(Conflict(1, "", firstLines(c))), note = Some(removedInSpec))
      case (Some(b), Some(n), None)     =>
        // the developer deleted it - that stays, unless Orch Spec changed it
        if same(b.content, n.content) then file(Action.unchanged, note = Some("deleted in the code"))
        else file(Action.conflict, Some(n.content), Seq(Conflict(1, firstLines(n.content), "")), Some(deletedInCode))
      case (None, Some(n), Some(c))     =>
        if same(c, n.content) then file(Action.unchanged)
        else
          n.kind match
            case FileKind.Simulation    => file(Action.update, Some(n.content))
            case FileKind.Scaffold      => file(Action.unchanged, note = Some("exists - created once, it stays"))
            case FileKind.ProcessObject => processObject(n, c)
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
        val unsure  = Seq.newBuilder[String]
        val added   = neu.foldLeft(existing): (content, r) =>
          val left = r.unsure(content)
          if left.nonEmpty then
            unsure += s"${left.mkString(", ")} not added to `${r.name}`: registered already, perhaps from another package (several wildcard imports bring the name) - check the imports."
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
        val notes   = unsure.result()
        if todo.nonEmpty then
          planned(
            Action.conflict,
            Option.when(removed != existing)(removed),
            todo.map((_, snippet) => Conflict(0, snippet, "")),
            Some((todo.map(_._1) ++ notes).mkString(" "))
          )
        else
          val note = Option.when(notes.nonEmpty)(notes.mkString(" "))
          if removed == existing then planned(Action.unchanged, note = note)
          else planned(Action.merged, Some(removed), note = note)
        end if
    end match
  end register

  /** What goes of a Scala file Orch Spec does not give: its classes and objects - the file only when
    * nothing else is in it; the rest (top-level `def`s, extensions, `given`s) stays. None: no class.
    */
  private def orphaned(code: String): Option[Removal] =
    val r = ScalaMerge.orphaned(code)
    Option.when(r.names.nonEmpty)(Removal(r.names, r.rest))

  /** The Scala files next to the domain classes of the export that Orch Spec does not know - in
    * the own packages of an API or a process (`…/v1/`, `…/v1/schema/`), not in a shared level of
    * the hierarchy; not a service or process object (another export may give it): the question
    * whether they go.
    */
  private def orphans(project: os.Path, generated: Seq[GeneratedFile], planned: Set[os.RelPath]): Seq[PlannedFile] =
    // a service or process object - its `topicName`/`processName` defined, not only named
    val ownObject = "(?m)^\\s*(?:(?:final|lazy|override|private|protected)\\s+)*(?:val|def)\\s+(?:topicName|processName)\\b".r
    val dirs = generated.filter(f => f.kind == FileKind.Export && f.rel.ext == "scala").map(_.rel / os.up)
      .filter(_.segments.exists(_.matches("v\\d+"))).distinct.sortBy(_.toString)
    dirs.filter(d => os.isDir(project / d)).flatMap: dir =>
      os.list(project / dir).filter(f => os.isFile(f) && f.ext == "scala").map(_.relativeTo(project))
        .filterNot(planned).sortBy(_.toString).flatMap: rel =>
          // a file that cannot be read (not UTF-8) is not asked - and does not stop the plan
          Try(os.read(project / rel)).toOption.flatMap: code =>
            if ownObject.findFirstIn(code).isDefined then None
            else
              orphaned(code).map: r =>
                PlannedFile(rel.toString, Owner.generated, Action.unchanged, hashOf(project / rel), note = Some("not in orch-spec"),
                  removal = Some(r))
  end orphans

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
