package orchescala.helper.dev.update

import orchescala.domain.BpmnProcessType

/** Creates a process from the exports of Orch Spec:
  *   - the BPMN export - the process id gives the names (process, version, object); without it the
  *     BPMN template is created,
  *   - the Scala export - the domain classes of the process.
  *
  * Besides the domain classes and the BPMN it creates the workers of the process (init worker,
  * custom tasks, signal- and message events) and the simulation - like `./helper.scala process`
  * does - and registers them in the `WorkerApp` and the `ApiProjectCreator`.
  *
  * Existing files are never overwritten - so the command can be re-run after adding new classes
  * in Orch Spec.
  */
case class OrchSpecGenerator()(using config: DevConfig):

  def createProcess(bpmn: Option[String], scalaExport: String): Unit =
    val files                     = OrchSpecExport.parse(scalaExport)
    val (processFile, classFiles) = files.partition(_.insert)
    val bpmnProcessId             = bpmn.flatMap(OrchSpecExport.processId)
    val fromBpmn                  = bpmnProcessId.map(OrchSpecNames(_, config.projectName))
    // the package is in the exported classes - so they decide, if there are any
    val fromExport                = Option.when(files.nonEmpty):
      val (processName, version) = processAndVersion(packageOf(OrchSpecExport.processDir(files)))
      OrchSpecNames(
        processName,
        version,
        processFile.headOption.map(_.path.last.stripSuffix(".scala"))
          .orElse(fromBpmn.filter(_.processName == processName).map(_.objectName))
          .getOrElse(s"${processName.head.toUpper}${processName.tail}")
      )
    for b <- fromBpmn; e <- fromExport if b != e do
      println(
        s"${Console.YELLOW}WARNING: The BPMN (${bpmnProcessId.mkString}) gives $b, the Scala classes $e - the Scala classes are taken.${Console.RESET}"
      )
    val OrchSpecNames(processName, versionNr, objectName) = fromExport.orElse(fromBpmn).getOrElse:
      throw IllegalArgumentException("Neither a BPMN with a process id nor Scala classes - nothing to create.")
    val version                   = Some(versionNr)
    val pkg                       = s"${config.projectPackage}.domain.$processName.v$versionNr"
    val setupElement              = SetupElement("Process", processName, objectName, version)
    val domainDir                 = BpmnGenerator().domainPath(processName, version)
    val hasSchema                 = classFiles.exists(_.path.segments.contains("schema"))
    val schemaImport              = s"import $pkg.schema.*"
    val processId                 = bpmnProcessId.getOrElse(setupElement.identifier)

    // objects of another project (a custom task whose topic is not of this process) exist there
    // already - neither their domain object nor their worker is created here
    val (ownFiles, foreignFiles) = classFiles.partition(f => !OrchSpecExport.isForeign(f.content, processId))
    foreignFiles.flatMap(f => OrchSpecExport.interaction(f.content).map(_._1 -> OrchSpecExport.topicName(f.content)))
      .foreach: (name, topic) =>
        println(
          s"${Console.YELLOW}$name (${topic.getOrElse("-")}) is not of $processId - exists in its project, not created.${Console.RESET}"
        )

    // domain
    ownFiles.foreach: file =>
      val inSchema = file.path.segments.contains("schema")
      createOrCompare(
        domainDir / file.path.relativeTo(OrchSpecExport.processDir(files)),
        if hasSchema && !inSchema then OrchSpecExport.withImport(file.content, schemaImport)
        else file.content
      )()
    val processObject = OrchSpecProcessObject(
      pkg,
      objectName,
      processId,
      processFile.headOption.map(_.content).getOrElse(""),
      Option.when(hasSchema)(schemaImport)
    )
    // only what comes from Orch Spec is compared - the rest of the process object is implementation
    createOrCompare(domainDir / s"$objectName.scala", processObject.content)(processObject.differences)
    processObject.warnings.foreach(w => println(s"${Console.YELLOW}WARNING: $w${Console.RESET}"))

    // bpmn
    bpmn match
      case Some(xml) =>
        val processType =
          if OrchSpecExport.isC8(xml) then
            config.bpmnProcessType match
              case c8: BpmnProcessType.C8 => c8
              case _                      => BpmnProcessType.C8()
          else
            config.bpmnProcessType match
              case _: BpmnProcessType.C8 => BpmnProcessType.C7()
              case other                 => other
        val name        = processId.stripPrefix(s"${config.companyName}-")
        createOrCompare(os.pwd / processType.diagramPath / s"$name.bpmn", xml)()
      case None      =>
        BpmnProcessGenerator(config.bpmnProcessType).createBpmn(setupElement)
    end match

    // workers
    WorkerGenerator().createProcessWorker(
      setupElement,
      processObject.customInit
        .getOrElse(if processObject.hasInitIn then "InitIn.example" else "InitIn()")
    )
    val interactions = ownFiles.flatMap(f =>
      OrchSpecExport.interaction(f.content).map((name, dsl) => (name, dsl, OrchSpecExport.topicName(f.content)))
    )
    val customTasks  = OrchSpecExport.workerNames(interactions, processId)
    customTasks.foreach: name =>
      WorkerGenerator().createWorker(SetupElement("CustomTask", processName, name, version))
    val workers      = objectName +: customTasks

    // simulation
    SimulationGenerator().createSimulation(setupElement)

    // registration in the WorkerApp and the API documentation - on a re-run the missing entries are added
    val versionPackage = version.versionPackage
    register(
      config.projectDir / ModuleConfig.workerModule.packagePath(config.projectPath) / "WorkerApp.scala",
      OrchSpecRegistration(
        "WorkerApp",
        "workers(",
        s"${processName}Workers",
        workers.map(w => s"${w}Worker()"),
        entries =>
          s"""  private lazy val ${processName}Workers =
             |    import ${config.projectPackage}.worker.$processName$versionPackage.*
             |    Seq(
             |${entries.map(e => s"      $e,").mkString("\n")}
             |    )
             |  end ${processName}Workers""".stripMargin
      )
    )
    register(
      config.projectDir / ModuleConfig.apiModule.packagePath(config.projectPath) / "ApiProjectCreator.scala",
      OrchSpecRegistration(
        "ApiProjectCreator",
        "document(",
        s"${processName}Api",
        interactions.map((name, _, _) => s"$name.example"),
        entries =>
          s"""  private lazy val ${processName}Api =
             |    import ${config.projectPackage}.domain.$processName$versionPackage.*
             |    api($objectName.example)(${
              if entries.isEmpty then ")"
              else entries.map(e => s"      $e,").mkString("\n", "\n", "\n    )")
            }
             |  end ${processName}Api""".stripMargin
      )
    )
  end createProcess

  /** Creates the file - an existing one is never overwritten, only compared with Orch Spec
    * (`differences`: what differs, empty if nothing).
    */
  private def createOrCompare(file: os.Path, content: String)(
      differences: String => Seq[String] = OrchSpecExport.differences(_, content)
  ): Unit =
    if !os.exists(file) then createIfNotExists(file, content)
    else
      differences(os.read(file)) match
        case Seq()                  =>
          println(s"UNCHANGED: $file")
        case Seq(OrchSpecExport.whole) =>
          println(
            s"${Console.YELLOW}DIFFERS from Orch Spec: $file - merge it manually, or delete it and run again.${Console.RESET}"
          )
        case parts                  =>
          println(
            s"${Console.YELLOW}DIFFERS from Orch Spec: $file (${parts.mkString(", ")}) - merge it manually, or delete it and run again.${Console.RESET}"
          )
  end createOrCompare

  private def register(file: os.Path, registration: OrchSpecRegistration): Unit =
    val result =
      if os.exists(file) then registration.register(os.read(file))
      else RegistrationResult.Manual(s"$file does not exist.", registration.snippet(registration.entries))
    result match
      case RegistrationResult.Unchanged                =>
        println(s"UNCHANGED: ${registration.name} in $file")
      case RegistrationResult.Registered(content, added) =>
        println(s"${Console.BLUE}Updated - $file (${registration.name}: ${added.mkString(", ")})${Console.RESET}")
        os.write.over(file, content)
      case RegistrationResult.Manual(reason, snippet)  =>
        println(
          s"""${Console.RED}NOT Updated - $reason
             |Add it manually to ${registration.objectName}:${Console.RESET}
             |$snippet""".stripMargin
        )
    end match
  end register

  private def packageOf(processDir: os.RelPath): String =
    processDir.segments.dropWhile(_ != "scala").drop(1).mkString(".")

  // `<projectPackage>.domain.<processName>.v<version>` - the package Orch Spec derives from the process id
  private def processAndVersion(pkg: String): (String, Int) =
    val Expected = s"""${java.util.regex.Pattern.quote(config.projectPackage)}\\.domain\\.(\\w+)\\.v(\\d+)""".r
    pkg match
      case Expected(processName, version) => processName -> version.toInt
      case other                          =>
        throw IllegalArgumentException(
          s"""The package of the export '$other' does not belong to this project.
             |Expected: ${config.projectPackage}.domain.<processName>.v<version>
             |Check company and project of the process in Orch Spec.""".stripMargin
        )
    end match
  end processAndVersion

end OrchSpecGenerator

/** The names of the process - `kundenkontaktDokumentieren`, `1`, `KundenkontaktDokumentieren`. */
case class OrchSpecNames(processName: String, version: Int, objectName: String):
  override def toString = s"$processName v$version ($objectName)"

object OrchSpecNames:
  private val Versioned = """([A-Za-z][A-Za-z0-9]*?)V(\d+)""".r

  /** The names from the process id - the same way Orch Spec derives them:
    *   - `valiant-addresschange-kundenkontakt-dokumentieren` -> `kundenkontaktDokumentieren`, 1, `KundenkontaktDokumentieren`
    *   - `globex-savings-openSavingsV2` -> `openSavings`, 2, `OpenSavingsV2`
    */
  def apply(processId: String, projectName: String): OrchSpecNames =
    val bare = processId.stripPrefix(s"$projectName-")
    bare match
      case Versioned(name, version) =>
        OrchSpecNames(name, version.toInt, s"${name.head.toUpper}${name.tail}V$version")
      case _                        =>
        val parts = bare.split("[^A-Za-z0-9]+").toSeq.filter(_.nonEmpty)
        val name  =
          if parts.size > 1 && bare == projectName then parts.last
          else if parts.isEmpty then "process"
          else (parts.head +: parts.tail.map(p => s"${p.head.toUpper}${p.tail}")).mkString
        OrchSpecNames(name, 1, s"${name.head.toUpper}${name.tail}")
    end match
  end apply
end OrchSpecNames

/** One file of the Scala export - `insert` marks the content of the process object. */
case class OrchSpecFile(path: os.RelPath, content: String, insert: Boolean = false)

/** Registers the process in an object like the `WorkerApp` or the `ApiProjectCreator`:
  * {{{
  * object WorkerApp extends CompanyWorkerApp:
  *   workers(
  *     myProcessWorkers,        // name - added to the list
  *     ..
  *   )
  *   ..
  *   private lazy val myProcessWorkers =   // block - added at the end
  *     import ..
  *     Seq(
  *       MyProcessWorker(),     // entries
  *     )
  *   end myProcessWorkers
  * end WorkerApp
  * }}}
  * Is the block already there (a re-run), the missing entries are added to it.
  */
case class OrchSpecRegistration(
    objectName: String,
    listStart: String,
    name: String,
    // `MyProcessWorker()` / `MyUserTaskUT.example`
    entries: Seq[String],
    block: Seq[String] => String
):

  def register(content: String): RegistrationResult =
    val lines = content.linesIterator.toSeq
    val start = lines.indexWhere(_.matches(s"""\\s*(private\\s+)?lazy val $name\\s*=.*"""))
    if start >= 0 then addEntries(lines, start)
    else addBlock(lines)
  end register

  def snippet(missing: Seq[String]): String =
    s"""  $listStart
       |    $name,
       |    ..
       |  )
       |
       |${block(missing)}""".stripMargin

  private def addBlock(lines: Seq[String]): RegistrationResult =
    val list = lines.indexWhere(_.trim == listStart)
    val end  = lines.indexWhere(_.trim == s"end $objectName")
    if list < 0 || end < list then
      RegistrationResult.Manual(s"$objectName has no `$listStart` or no `end $objectName`.", snippet(entries))
    else
      val withEntry = insertEntry(lines, list)
      RegistrationResult.Registered(
        insertBlock(withEntry, end + withEntry.size - lines.size).mkString("\n") + "\n",
        Seq(name)
      )
    end if
  end addBlock

  // alphabetically next to its neighbour: after the closest name before it, else before the
  // closest after it - the order of the others stays (in `document(…)` it is the order of the docs)
  private def neighbours(names: Seq[(Int, String)]): (Option[Int], Option[Int]) =
    val before = names.filter(_._2.compareToIgnoreCase(name) < 0)
    val after  = names.filter(_._2.compareToIgnoreCase(name) > 0)
    (
      before.maxByOption(_._2.toLowerCase).map(_._1),
      after.minByOption(_._2.toLowerCase).map(_._1)
    )
  end neighbours

  /** The name alphabetically in the list (see `neighbours`). Comments (`//TODO add workers here`)
    * are no entries. Trailing commas are fine - the closing parenthesis is always on its own line.
    */
  private def insertEntry(lines: Seq[String], list: Int): Seq[String] =
    val entry = " " * (indentOf(lines(list)) + 2) + s"$name,"
    val close = lines.indexWhere(_.trim == ")", list + 1)
    val items =
      if close < 0 then Seq.empty
      else
        (list + 1 until close)
          .filter(i => !lines(i).isBlank && !lines(i).trim.startsWith("//"))
          .map(i => i -> lines(i).trim.stripSuffix(",").trim)
    neighbours(items) match
      case (Some(i), _)    =>
        val comma = if lines(i).stripTrailing.endsWith(",") then lines(i) else lines(i).stripTrailing + ","
        lines.patch(i, Seq(comma, entry), 1)
      case (None, Some(i)) =>
        lines.patch(i, Seq(entry), 0)
      case _               =>
        lines.patch(list + 1, Seq(entry), 0)
    end match
  end insertEntry

  /** The block alphabetically among the blocks of its kind (`…Workers` / `…Api`, see `neighbours`)
    * - after the `end` of the one before, else before the one after (with the comments above it),
    * else at the end of the object.
    */
  private def insertBlock(lines: Seq[String], end: Int): Seq[String] =
    val blockLines = block(entries).linesIterator.toSeq
    val suffix     = "[A-Z][a-z0-9]*$".r.findFirstIn(name).getOrElse("")
    val start      = s"""\\s*(?:private\\s+)?lazy val (\\w+$suffix)\\s*=.*""".r
    val blocks     = (0 until end).flatMap(i =>
      lines(i) match
        case start(other) => Seq(i -> other)
        case _            => Seq.empty
    )
    val blockEnd   = (i: Int) =>
      val other = blocks.find(_._1 == i).get._2
      Some(lines.indexWhere(_.trim == s"end $other", i)).filter(e => e >= 0 && e < end)
    neighbours(blocks) match
      case (Some(i), _) if blockEnd(i).isDefined =>
        val at    = blockEnd(i).get + 1
        val after = if lines.lift(at).exists(!_.isBlank) then Seq("") else Seq.empty
        lines.patch(at, ("" +: blockLines) ++ after, 0)
      case (_, Some(i))                          =>
        val comments = (i - 1 to 0 by -1).takeWhile(j => lines(j).trim.startsWith("//")).size
        val at       = i - comments
        val before   = if at > 0 && !lines(at - 1).isBlank then Seq("") else Seq.empty
        lines.patch(at, before ++ blockLines :+ "", 0)
      case _                                     =>
        val body = lines.take(end).reverse.dropWhile(_.isBlank).reverse
        body ++ ("" +: blockLines :+ "") ++ lines.drop(end)
    end match
  end insertBlock

  /** A re-run: the block is there - the new entries go before its last closing parenthesis. */
  private def addEntries(lines: Seq[String], start: Int): RegistrationResult =
    val end     = lines.indexWhere(_.trim == s"end $name", start)
    val inBlock = if end < 0 then lines.drop(start) else lines.slice(start, end)
    val missing = entries.filterNot: e =>
      val key = e.takeWhile(c => c.isLetterOrDigit || c == '_')
      inBlock.exists(s"""\\b$key\\b""".r.findFirstIn(_).isDefined)
    val manual  = (reason: String) =>
      RegistrationResult.Manual(reason, s"  // in $name\n${missing.map(e => s"      $e,").mkString("\n")}")
    if missing.isEmpty then RegistrationResult.Unchanged
    else if end < 0 then manual(s"$objectName has no `end $name`.")
    else
      val closing = (start until end).findLast(i => lines(i).trim == ")")
      val empty   = (start until end).findLast(i => lines(i).stripTrailing.endsWith(")()"))
      (closing, empty) match
        // `api(MyProcess.example)()` - the first run had no interactions
        case (_, Some(i)) if closing.forall(_ < i) =>
          val indent = " " * indentOf(lines(i))
          val opened = lines(i).stripTrailing.dropRight(1)
          RegistrationResult.Registered(
            lines.patch(i, (opened +: missing.map(e => s"$indent  $e,")) :+ s"$indent)", 1).mkString("\n") + "\n",
            missing
          )
        case (Some(i), _)                          =>
          val indent = " " * (indentOf(lines(i)) + 2)
          // the last entry may have no trailing comma
          val last   = (start until i).findLast(j => !lines(j).isBlank).get
          val comma  =
            if lines(last).stripTrailing.endsWith(",") || lines(last).stripTrailing.endsWith("(") then lines(last)
            else lines(last).stripTrailing + ","
          RegistrationResult.Registered(
            lines.patch(last, Seq(comma), 1).patch(i, missing.map(e => s"$indent$e,"), 0).mkString("\n") + "\n",
            missing
          )
        case _                                     =>
          manual(s"$name has not the expected form.")
      end match
    end if
  end addEntries

  private def indentOf(line: String) = line.indexWhere(_ != ' ')

end OrchSpecRegistration

enum RegistrationResult:
  case Unchanged
  case Registered(content: String, added: Seq[String])
  case Manual(reason: String, snippet: String)

object OrchSpecExport:

  private val fileRule    = "// " + "─" * 72
  private val sectionRule = "// " + "═" * 72

  /** Splits the Scala export into its files:
    * {{{
    * // ────────
    * // 01-domain/src/main/scala/.../MyTask.scala  (in die bestehende Datei einfügen)
    * // ────────
    *
    * content
    * }}}
    * Section headers (`// ════════`) only group the files - they are dropped.
    */
  def parse(text: String): Seq[OrchSpecFile] =
    val lines = text.linesIterator.toVector

    def isFileHeader(i: Int)    =
      lines(i) == fileRule && i + 2 < lines.size && lines(i + 2) == fileRule
    def isSectionHeader(i: Int) =
      lines(i) == sectionRule && i + 2 < lines.size && lines(i + 2) == sectionRule

    val headers = lines.indices.filter(isFileHeader)
    headers.zipWithIndex.map: (start, n) =>
      val end     = headers.lift(n + 1).getOrElse(lines.size)
      val header  = lines(start + 1).stripPrefix("// ").trim
      val body    = lines.slice(start + 3, end)
      val content = body.indices
        .find(i => isSectionHeader(start + 3 + i))
        .map(body.take)
        .getOrElse(body)
      // `path  (in die bestehende Datei einfügen)` - the path has no blanks
      val path    = header.takeWhile(!_.isWhitespace)
      OrchSpecFile(
        os.RelPath(path),
        content.mkString("\n").trim + "\n",
        insert = header.drop(path.length).trim.nonEmpty
      )
  end parse

  /** The directory of the process - the classes in `schema/` are one level below. */
  def processDir(files: Seq[OrchSpecFile]): os.RelPath =
    val dirs = files.map: f =>
      val dir = f.path / os.up
      if dir.last == "schema" then dir / os.up else dir
    dirs.distinct match
      case Seq(dir) => dir
      case other    =>
        throw IllegalArgumentException(
          s"The export contains files of more than one process: ${other.mkString(", ")}"
        )
  end processDir

  /** The id of the executable process in the BPMN. */
  def processId(bpmn: String): Option[String] =
    val processes = """<(?:\w+:)?process\s[^>]*>""".r.findAllIn(bpmn).toSeq
    val id        = """\sid="([^"]+)"""".r
    processes
      .sortBy(p => !p.contains("""isExecutable="true""""))
      .flatMap(id.findFirstMatchIn(_).map(_.group(1)))
      .headOption
  end processId

  /** Marks a file that differs as a whole (and not only in parts). */
  val whole = "whole"

  /** `Seq(whole)` if the existing file differs from the export - blanks at the line ends do not count. */
  def differences(existing: String, exported: String): Seq[String] =
    if normalized(existing) == normalized(exported) then Seq.empty else Seq(whole)

  private[update] def normalized(text: String): Seq[String] =
    text.linesIterator.map(_.stripTrailing).toSeq.reverse.dropWhile(_.isEmpty).reverse

  def isC8(bpmn: String): Boolean =
    bpmn.contains("http://camunda.org/schema/zeebe/1.0")

  /** Object name and DSL of an interaction - `MyTask -> CustomTask` for `object MyTask extends CompanyBpmnCustomTaskDsl`. */
  def interaction(content: String): Option[(String, String)] =
    """(?m)^object (\w+) extends CompanyBpmn(\w+)Dsl""".r
      .findFirstMatchIn(content)
      .map(m => m.group(1) -> m.group(2))

  /** The interactions that get a worker: the custom tasks of this process - their topic starts with
    * the process id (`valiant-product-orderCard-…`, also `…orderCardV1-…`); one of another project
    * exists there already. A user task, a signal and a message have none - a validation worker was
    * created and registered for each signal and message.
    */
  def workerNames(interactions: Seq[(String, String, Option[String])], processId: String): Seq[String] =
    interactions.collect { case (name, "CustomTask", Some(topic)) if topic.startsWith(processId) => name }

  /** An interaction object of another project: a custom task whose topic does not start with the
    * process id - its domain object and worker exist there (the export of Orch Spec leaves out the
    * others of another package; it knows the catalog).
    */
  def isForeign(content: String, processId: String): Boolean =
    interaction(content).exists((_, dsl) => dsl == "CustomTask") &&
      !topicName(content).exists(_.startsWith(processId))

  /** `val topicName = "…"` of a worker object. */
  def topicName(content: String): Option[String] =
    """(?m)^\s*val topicName\s*=\s*"([^"]*)"""".r.findFirstMatchIn(content).map(_.group(1))

  /** Adds an import after the package clause. */
  def withImport(content: String, importLine: String): String =
    if content.contains(importLine) then content
    else
      val (head, rest) = content.linesIterator.toSeq.span(_.startsWith("package "))
      (head ++ Seq("", importLine) ++ rest.dropWhile(_.isBlank).prepended("")).mkString("\n") + "\n"

end OrchSpecExport

/** The process object from the part of the export that goes into it (`In`, `Out`, `InConfig`,
  * `InitIn`). Orch Spec leaves the rest to the implementation - this adds it:
  *   - `processName`, `descr` and the examples of the process,
  *   - the `inConfig` of `In` (`WithConfig`), so the mocks of `InConfig` can be used,
  *   - empty classes for what the export does not contain.
  */
case class OrchSpecProcessObject(
    pkg: String,
    objectName: String,
    processId: String,
    block: String,
    schemaImport: Option[String] = None
):
  private lazy val blockLines = block.linesIterator.toSeq
  // the export lists the imports as comments: `// import …`
  private lazy val imports    = blockLines.collect:
    case l if l.startsWith("// import ") => l.stripPrefix("// ")
  private lazy val body       = blockLines
    .dropWhile(l => l.isBlank || l.trim.startsWith("//"))

  private def defines(name: String) =
    body.exists(l => l.startsWith(s"  case class $name(") || l.startsWith(s"  enum $name:"))
  private def isEnum(name: String)  = body.exists(_.startsWith(s"  enum $name:"))

  lazy val hasInitIn: Boolean = defines("InitIn")

  /** What the init worker returns in `customInit` - the export puts it as comment before the classes:
    * {{{
    * // im InitWorker (customInit):
    * // InitIn(
    * //   debitAccountForFee = in.debitAccountForFee.getOrElse(90)
    * // )
    * }}}
    * (the optional fields of `In` with a default - in `InitIn` they are required)
    */
  lazy val customInit: Option[String] =
    val start = blockLines.indexWhere(_.trim == "// im InitWorker (customInit):")
    Option.when(start >= 0):
      blockLines.drop(start + 1).takeWhile(_.startsWith("// ")).map(_.stripPrefix("// ")).mkString("\n")
    .filter(_.nonEmpty)

  /** What differs in an existing process object - only what comes from Orch Spec: the types of
    * the export (`In`, `Out`, `InConfig`, `InitIn`) and the imports. The rest is implementation.
    */
  def differences(existing: String): Seq[String] =
    val existingLines  = OrchSpecExport.normalized(existing)
    val generatedLines = OrchSpecExport.normalized(content)
    val types          = Seq("In", "Out", "InConfig", "InitIn")
      .filter(defines)
      .filter(t => section(generatedLines, t) != section(existingLines, t))
    val missingImports = (imports ++ schemaImport).filterNot(i => existingLines.exists(_.trim == i.trim))
    types ++ Option.when(missingImports.nonEmpty)("imports")
  end differences

  // from `case class In(` / `enum In` to the last `end In` (of the companion)
  private def section(lines: Seq[String], name: String): Seq[String] =
    val start = lines.indexWhere(l => l.startsWith(s"  case class $name(") || l.matches(s"  enum $name\\b.*"))
    val end   = lines.lastIndexWhere(_ == s"  end $name")
    if start < 0 || end < start then Seq.empty else lines.slice(start, end + 1)

  // an enum without fields (`case a, b`) cannot carry the inConfig
  lazy val warnings: Seq[String] =
    if isEnum("In") && !body.exists(_.matches("    case \\w+\\(")) then
      Seq(
        s"$objectName.In is an enum without fields - it cannot carry the `inConfig` (WithConfig) - the mocks of InConfig will not work."
      )
    else Seq.empty

  // no stripMargin - it would also strip the lines of the exported classes
  lazy val content: String =
    val types      =
      Option.when(!defines("In"))(emptyIn) ++
        Option.when(body.nonEmpty)(if defines("In") then withConfig(body).mkString("\n") else body.mkString("\n")) ++
        Seq("InConfig" -> emptyInConfig, "InitIn" -> emptyInitIn, "Out" -> emptyClass("Out"))
          .collect { case (name, empty) if !defines(name) => empty }
    val allImports = (imports ++ schemaImport).distinct
    Seq(
      Seq(s"package $pkg", ""),
      if allImports.isEmpty then Seq.empty else allImports :+ "",
      Seq(
        s"object $objectName extends CompanyBpmnProcessDsl:",
        "",
        s"""  val processName = "$processId"""",
        """  val descr: String = """"",
        ""
      ),
      Seq(types.mkString("\n\n"), ""),
      Seq(
        "  lazy val example = process(",
        "    In.example,",
        "    Out.example,",
        "    InitIn.example",
        "  )",
        "",
        "  lazy val exampleMinimal = process(",
        s"    ${minimal("In")},",
        s"    ${minimal("Out")},",
        s"    ${minimal("InitIn")}",
        "  )",
        s"end $objectName",
        ""
      )
    ).flatten.mkString("\n")
  end content

  // the companion of an enum has no exampleMinimal
  private def minimal(name: String) =
    if isEnum(name) then s"$name.example" else s"$name.exampleMinimal"

  // without a value - in the domain objects only the InConfig has defaults; the examples set it
  private def inConfigField(indent: String) =
    s"""$indent@description("A way to override process configuration.\\n\\n**SHOULD NOT BE USED on Production!**")
       |${indent}inConfig: Option[InConfig]""".stripMargin

  private val withConfigEnd =
    """  ) extends WithConfig[InConfig]:
      |    lazy val defaultConfig = InConfig()""".stripMargin

  /** `In` gets the `inConfig` field and extends `WithConfig[InConfig]` - its examples `inConfig = None`. */
  private def withConfig(lines: Seq[String]): Seq[String] =
    if lines.exists(_.contains("WithConfig")) then lines
    else if isEnum("In") then inConfigInExamples(enumWithConfig(lines))
    else inConfigInExamples(classWithConfig(lines))

  /** `lazy val example = In(…)` / `In.Case(…)` gets `inConfig = None` as last argument. */
  private def inConfigInExamples(lines: Seq[String]): Seq[String] =
    val opening = """(\s*)lazy val example(?:: In(?:\.\w+)?)? = In(?:\.\w+)?\(""".r
    val empty   = """(.*lazy val example(?:: In(?:\.\w+)?)? = In(?:\.\w+)?)\(\)""".r
    lines.indices.foldLeft(lines): (done, i) =>
      done(i) match
        case empty(head)     => done.updated(i, s"$head(inConfig = None)")
        case opening(indent) =>
          val end = done.indexWhere(_ == s"$indent)", i)
          if end < 0 then done
          else done.patch(end - 1, Seq(done(end - 1) + ",", s"$indent  inConfig = None"), 1)
        case _               => done
  end inConfigInExamples

  private def classWithConfig(lines: Seq[String]): Seq[String] =
    val start = lines.indexWhere(_.startsWith("  case class In("))
    if start < 0 then lines
    else if lines(start) == "  case class In()" then
      lines.patch(start, Seq("  case class In(", inConfigField("      "), withConfigEnd), 1)
    else
      val end = lines.indexWhere(_ == "  )", start)
      if end < 0 then lines
      else
        lines
          .patch(end, Seq(inConfigField("      "), withConfigEnd), 1)
          .patch(end - 1, Seq(lines(end - 1) + ","), 1)
    end if
  end classWithConfig

  /** An enum with fields (ADT): the enum extends `WithConfig[InConfig]`, each case gets the
    * `inConfig` field - a case without fields too (`case B` -> `case B(inConfig: ..)`,
    * `In.B` -> `In.B(inConfig = None)`).
    */
  private def enumWithConfig(lines: Seq[String]): Seq[String] =
    val start    = lines.indexWhere(_ == "  enum In:")
    val end      = lines.indexWhere(_ == "  end In", start)
    val bareCase = """    case (\w+)""".r
    if start < 0 || end < 0 || !lines.slice(start, end).exists(_.matches("    case \\w+\\(")) then lines
    else
      val cases   = lines.slice(start + 1, end).foldLeft(Vector.empty[String]):
        case (done, "    )")       =>
          done.init ++ Seq(done.last + ",", inConfigField("        "), "    )")
        case (done, bareCase(name)) =>
          done ++ Seq(s"    case $name(", inConfigField("        "), "    )")
        case (done, line)           => done :+ line
      val bare    = lines.slice(start + 1, end).collect { case bareCase(name) => name }
      val applied = lines.drop(end).map: line =>
        bare.foldLeft(line)((l, name) => l.replaceAll(s"\\bIn\\.$name\\b(?![\\w(])", s"In.$name(inConfig = None)"))
      lines.take(start) ++
        Seq("  enum In extends WithConfig[InConfig]:", "    lazy val defaultConfig = InConfig()", "") ++
        cases ++ applied
    end if
  end enumWithConfig

  private def emptyClass(name: String, fields: String = "") =
    s"""  case class $name($fields)
       |
       |  object $name:
       |    given ApiSchema[$name]  = deriveApiSchema
       |    given InOutCodec[$name] = deriveInOutCodec
       |
       |    lazy val example = $name()
       |    lazy val exampleMinimal = example
       |  end $name""".stripMargin

  private lazy val emptyIn =
    s"""  case class In(
       |${inConfigField("      ")}
       |$withConfigEnd
       |
       |  object In:
       |    given ApiSchema[In]  = deriveApiSchema
       |    given InOutCodec[In] = deriveInOutCodec
       |
       |    lazy val example = In(inConfig = None)
       |    lazy val exampleMinimal = example
       |  end In""".stripMargin

  private lazy val emptyInConfig =
    """  case class InConfig()
      |
      |  object InConfig:
      |    given ApiSchema[InConfig]  = deriveApiSchema
      |    given InOutCodec[InConfig] = deriveInOutCodec
      |  end InConfig""".stripMargin

  private lazy val emptyInitIn = emptyClass("InitIn")

end OrchSpecProcessObject
