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
  * in Orch Spec. The one exception is the process object: the types from Orch Spec are merged into
  * it, everything else in it stays (see `OrchSpecProcessObject.merge`).
  */
case class OrchSpecGenerator()(using config: DevConfig):

  def createProcess(bpmn: Option[String], scalaExport: String, dmns: Seq[(String, String)] = Seq.empty): Unit =
    val files                     = OrchSpecExport.parse(scalaExport)
    val (processFile, classFiles) = files.partition(_.insert)
    val bpmnProcessId             = bpmn.flatMap(OrchSpecExport.processId)
    val fromBpmn                  = bpmnProcessId.map(OrchSpecNames(_, config.projectName))
    // the package is in the exported classes - so they decide, if there are any
    val fromExport                = Option.when(files.nonEmpty):
      val (processName, version) = processAndVersion(packageOf(OrchSpecExport.processDir(files)))
      val dir                    = BpmnGenerator().domainPath(processName, Some(version))
      // Orch Spec names the file after the object it knows from the domain - that one counts only
      // while its file exists; otherwise the name follows the process (the version is in the package)
      val exported               = processFile.headOption.map(_.path.last.stripSuffix(".scala"))
      val objectName             = OrchSpecNames.objectName(
        exported,
        fromBpmn.filter(_.processName == processName).map(_.objectName)
          .getOrElse(s"${processName.head.toUpper}${processName.tail}"),
        name => os.exists(dir / s"$name.scala")
      )
      for e <- exported if e != objectName do
        println(s"${Console.YELLOW}$e.scala does not exist (any more) - the process object is $objectName.${Console.RESET}")
      OrchSpecNames(processName, version, objectName)
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
    // only what comes from Orch Spec is merged - the rest of the process object is implementation
    mergeProcessObject(domainDir / s"$objectName.scala", processObject)
    processObject.warnings.foreach(w => println(s"${Console.YELLOW}WARNING: $w${Console.RESET}"))

    // bpmn - its engine decides where the diagrams go (camunda or camunda8)
    def processTypeOf(c8: Boolean): BpmnProcessType =
      OrchSpecGenerator.processTypeOf(config.projectBpmnProcessType, c8)
    bpmn match
      case Some(xml) =>
        val name = processId.stripPrefix(s"${config.companyName}-")
        createOrCompare(os.pwd / processTypeOf(OrchSpecExport.isC8(xml)).diagramPath / s"$name.bpmn", xml)()
      case None      =>
        BpmnProcessGenerator(config.projectBpmnProcessType).createBpmn(setupElement)
    end match

    // the tables of the DMN decisions - next to the BPMN (without a BPMN: the engine of the DMN)
    dmns.foreach: (file, xml) =>
      val c8 = bpmn.map(OrchSpecExport.isC8).getOrElse(OrchSpecExport.isC8Dmn(xml))
      createOrCompare(os.pwd / processTypeOf(c8).diagramPath / OrchSpecExport.dmnFileName(file), xml)()

    // workers
    WorkerGenerator().createProcessWorker(
      setupElement,
      processObject.customInit
        // not the example - that would run with its values; `???` fails, so it is clear what is to do
        .getOrElse(if processObject.hasInitIn then "???" else "InitIn()")
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

  /** The process object: created if it is new, otherwise the types and imports from Orch Spec are
    * merged into it (see `OrchSpecProcessObject.merge`) - the rest stays.
    */
  private def mergeProcessObject(file: os.Path, processObject: OrchSpecProcessObject): Unit =
    if !os.exists(file) then createIfNotExists(file, processObject.content)
    else
      val existing = os.read(file)
      processObject.differences(existing) match
        case Seq() => println(s"UNCHANGED: $file")
        case parts =>
          os.write.over(file, processObject.merge(existing))
          println(s"${Console.GREEN}UPDATED from Orch Spec: $file (${parts.mkString(", ")})${Console.RESET}")
  end mergeProcessObject

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

  /** The name of the process object: the exported one (the object Orch Spec knows from the domain)
    * as long as its file exists - otherwise the name derived from the process (without the version).
    */
  def objectName(exported: Option[String], derived: String, exists: String => Boolean): String =
    exported.filter(exists).getOrElse(derived)

  /** The names from the process id - the same way Orch Spec derives them:
    *   - `valiant-addresschange-kundenkontakt-dokumentieren` -> `kundenkontaktDokumentieren`, 1, `KundenkontaktDokumentieren`
    *   - `globex-savings-openSavingsV2` -> `openSavings`, 2, `OpenSavings` (the version is in the package)
    */
  def apply(processId: String, projectName: String): OrchSpecNames =
    val bare = processId.stripPrefix(s"$projectName-")
    bare match
      case Versioned(name, version) =>
        OrchSpecNames(name, version.toInt, s"${name.head.toUpper}${name.tail}")
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

  /** A DMN of the Camunda Modeler for Camunda 8 - `modeler:executionPlatform="Camunda Cloud"`. */
  def isC8Dmn(dmn: String): Boolean =
    dmn.contains("executionPlatform=\"Camunda Cloud\"")

  /** The file name of a DMN table - only the name (no path out of the diagram folder), with `.dmn`. */
  def dmnFileName(file: String): String =
    val name = file.split("[/\\\\]").last.trim
    if name.endsWith(".dmn") then name else s"$name.dmn"

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

  /** `processLabels` of the process (de, fr) - the export gives them as `// processLabels: de | fr`. */
  lazy val processLabels: Option[(String, String)] =
    blockLines.collectFirst { case l if l.startsWith("// processLabels: ") => l.stripPrefix("// processLabels: ") }
      .flatMap: text =>
        text.split(" \\| ", 2).toSeq match
          case Seq(de, fr) => Some(de.trim -> fr.trim)
          case _           => None

  /** `val descr` of the process - the export gives it as `// descr: …` (already escaped). */
  lazy val descr: String =
    blockLines.collectFirst { case l if l.startsWith("// descr: ") => l.stripPrefix("// descr: ").trim }
      .getOrElse("")

  /** What differs in an existing process object - only what comes from Orch Spec: the types of
    * the export (`In`, `InitIn`, `InConfig`, `Out` and the other types of the block) and the
    * imports. The rest is implementation.
    */
  def differences(existing: String): Seq[String] =
    val existingLines = existing.linesIterator.toSeq
    val generated     = content.linesIterator.toSeq
    val types         = ObjectSections(generated).filter(g => blockTypes.contains(g.name))
      .filter(g => mergeType(existingLines, g, generated) != existingLines)
      .map(_.name)
    types ++ Option.when(missingLabels(existingLines))("processLabels") ++
      Option.when(missingImports(existingLines).nonEmpty)("imports")
  end differences

  /** The existing process object with what comes from Orch Spec: each type of the export replaces
    * the one of the same name, a missing one goes in its place (`In`, `InitIn`, `InConfig`, `Out`,
    * then the others), missing imports are added, and `processLabels` if the object has none - the
    * init worker sets `callingProcessKeyDE/FR` from them. Everything else stays as it is - the
    * package clause, the other imports, `descr`, existing `processLabels`, the examples of the
    * process, comments.
    */
  def merge(existing: String): String =
    val generated = content.linesIterator.toSeq
    val merged    = ObjectSections(generated).filter(g => blockTypes.contains(g.name))
      .foldLeft(existing.linesIterator.toSeq)(mergeType(_, _, generated))
    withImports(withLabels(merged), missingImports(merged)).mkString("\n") + "\n"
  end merge

  private def missingLabels(lines: Seq[String]): Boolean =
    processLabels.isDefined && !lines.exists(_.trim.startsWith("override def processLabels"))

  // after `val descr` - otherwise after `val processName`
  private def withLabels(lines: Seq[String]): Seq[String] =
    processLabels.filter(_ => missingLabels(lines)).fold(lines): (de, fr) =>
      val descr = lines.indexWhere(_.trim.startsWith("val descr"))
      val at    = if descr >= 0 then descr else lines.indexWhere(_.trim.startsWith("val processName"))
      if at < 0 then lines
      else lines.patch(at + 1, Seq("", "  override def processLabels: ProcessLabels =", s"""    ProcessLabels("$de", "$fr")"""), 0)

  /** One type of the export into the lines of the process object:
    *   - missing: inserted after the type that comes before it (`typeOrder`),
    *   - `InConfig` / `InitIn`: only the missing fields are added - they come from the flow, and
    *     what is there already (own mocks, examples) is implementation,
    *   - otherwise replaced - unless it differs only in blanks and line breaks.
    */
  private def mergeType(lines: Seq[String], g: ObjectSection, generated: Seq[String]): Seq[String] =
    val replacement = g.lines(generated)
    val sections    = ObjectSections(lines)
    sections.find(_.name == g.name) match
      case Some(e) if Seq("InConfig", "InitIn").contains(g.name) =>
        val own    = e.lines(lines)
        // a field without default must also be in the `example` - otherwise it does not compile
        val merged = CaseClassParams.addMissingToExample(CaseClassParams.addMissing(own, replacement), own, replacement, g.name)
        lines.patch(e.from, merged, e.until - e.from)
      case Some(e) if compact(e.lines(lines)) == compact(replacement) => lines
      case Some(e) => lines.patch(e.from, replacement, e.until - e.from)
      case None    =>
        // after the type that comes before it - otherwise before the first type, or before the
        // examples of the process
        val before = typeOrder.takeWhile(_ != g.name).reverse
          .flatMap(n => sections.find(_.name == n)).headOption
        val at     = before.map(_.until)
          .orElse(sections.headOption.map(_.from - 1))
          .getOrElse(lines.indexWhere(l => l.startsWith("  lazy val example") || l.startsWith("end ")))
        if at < 0 then lines
        else if before.isDefined then lines.patch(at, "" +: replacement, 0)
        else lines.patch(at + 1, replacement :+ "", 0)
    end match
  end mergeType

  private def compact(lines: Seq[String]) = lines.mkString.replaceAll("\\s+", "")

  // the types of the generated content in the order of the domain - In, InitIn, InConfig, Out
  private lazy val typeOrder: Seq[String] =
    val names = ObjectSections(content.linesIterator.toSeq).map(_.name)
    OrchSpecProcessObject.order.filter(names.contains) ++ names.filterNot(OrchSpecProcessObject.order.contains)

  // what the export brings - the empty classes for the rest are only for a new file
  private lazy val blockTypes: Seq[String] =
    val inBlock = ObjectSections(body).map(_.name)
    // without its own `In` the export still gives the `inConfig` - so the generated `In` counts
    inBlock ++ Option.when(inBlock.nonEmpty && !inBlock.contains("In"))("In")

  private def missingImports(lines: Seq[String]): Seq[String] =
    (imports ++ schemaImport).distinct.filterNot(OrchSpecImports.covered(lines, _))

  // after the last import - or after the package clause
  private def withImports(lines: Seq[String], missing: Seq[String]): Seq[String] =
    if missing.isEmpty then lines
    else
      val lastImport = lines.lastIndexWhere(_.startsWith("import "))
      if lastImport >= 0 then lines.patch(lastImport + 1, missing, 0)
      else
        val lastPackage = lines.lastIndexWhere(_.startsWith("package "))
        lines.patch(lastPackage + 1, "" +: missing, 0)

  // an enum without fields (`case a, b`) cannot carry the inConfig
  lazy val warnings: Seq[String] =
    if isEnum("In") && !body.exists(_.matches("    case \\w+\\(")) then
      Seq(
        s"$objectName.In is an enum without fields - it cannot carry the `inConfig` (WithConfig) - the mocks of InConfig will not work."
      )
    else Seq.empty

  // no stripMargin - it would also strip the lines of the exported classes
  lazy val content: String =
    val withIn     = if defines("In") then withConfig(body) else body
    val sections   = ObjectSections(withIn)
    val fromBlock  = sections.map(s => s.name -> s.lines(withIn).mkString("\n")).toMap
    val empties    = Seq(
      "In"       -> emptyIn,
      "InitIn"   -> emptyInitIn,
      "InConfig" -> emptyInConfig,
      "Out"      -> emptyClass("Out")
    )
    // In, InitIn, InConfig, Out - then what else is in the object, as in the export
    val types      =
      empties.map((name, empty) => fromBlock.getOrElse(name, empty)) ++
        sections.map(_.name).filterNot(OrchSpecProcessObject.order.contains).map(fromBlock)
    val allImports = (imports ++ schemaImport).distinct
    Seq(
      Seq(s"package $pkg", ""),
      if allImports.isEmpty then Seq.empty else allImports :+ "",
      Seq(
        s"object $objectName extends CompanyBpmnProcessDsl:",
        "",
        s"""  val processName = "$processId"""",
        s"""  val descr: String = "$descr"""",
        ""
      ),
      processLabels.toSeq.flatMap: (de, fr) =>
        Seq(
          "  override def processLabels: ProcessLabels =",
          s"""    ProcessLabels("$de", "$fr")""",
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

  // the exception to "no defaults in the domain objects": the inConfig is always initialised with None
  private def inConfigField(indent: String) =
    s"""$indent@description("A way to override process configuration.\\n\\n**SHOULD NOT BE USED on Production!**")
       |${indent}inConfig: Option[InConfig] = None""".stripMargin

  private val withConfigEnd =
    """  ) extends WithConfig[InConfig]:
      |    lazy val defaultConfig = InConfig()
      |  end In""".stripMargin

  /** `In` gets the `inConfig` field (default `None` - the examples need not set it) and extends
    * `WithConfig[InConfig]`.
    */
  private def withConfig(lines: Seq[String]): Seq[String] =
    if lines.exists(_.contains("WithConfig")) then lines
    else if isEnum("In") then enumWithConfig(lines)
    else classWithConfig(lines)

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
    * `inConfig` field - a case without fields too (`case B` -> `case B(inConfig: .. = None)`,
    * `In.B` -> `In.B()`).
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
        bare.foldLeft(line)((l, name) => l.replaceAll(s"\\bIn\\.$name\\b(?![\\w(])", s"In.$name()"))
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
       |    lazy val example = In()
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

object OrchSpecProcessObject:
  /** The order of the types in a process object. */
  val order: Seq[String] = Seq("In", "InitIn", "InConfig", "Out")

/** A type in an object - `case class X(` / `enum X` with its companion up to `end X`, the
  * scaladoc or comment right before it included. `from` / `until` are line indexes.
  */
case class ObjectSection(name: String, from: Int, until: Int):
  def lines(all: Seq[String]): Seq[String] = all.slice(from, until)

object ObjectSections:
  private val start = """  (?:final\s+)?(?:case class|enum)\s+(\w+)\b.*""".r

  /** The types on the first level of an object (indented by two). */
  def apply(lines: Seq[String]): Seq[ObjectSection] =
    lines.indices.collect { case i if start.matches(lines(i)) => i }.map: i =>
      val name = lines(i) match
        case start(n) => n
      // the scaladoc or comment right before - without a blank line in between
      val from = Iterator.iterate(i)(_ - 1).takeWhile(j => j == i || j >= 0 && isDoc(lines(j))).toSeq.last
      // the class, its body and its companion - until the next member of the object
      val end  = Iterator.from(i + 1).takeWhile(j => j < lines.size && belongs(lines(j), name)).toSeq
      val last = (i +: end).filterNot(j => lines(j).isBlank).last
      ObjectSection(name, from, last + 1)
    .toSeq
  end apply

  private def indent(l: String) = l.indexWhere(_ != ' ')

  private def isDoc(l: String) =
    val t = l.trim
    indent(l) >= 2 && (t.startsWith("/**") || t.startsWith("*") || t.startsWith("//"))

  private def belongs(l: String, name: String) =
    l.isBlank || indent(l) > 2 || l.startsWith("  )") ||
      l == s"  end $name" || l.startsWith(s"  object $name:") || l == s"  object $name"
end ObjectSections

/** The parameters of a `case class X(` - each with the annotations and comments before it. */
object CaseClassParams:

  /** The section with the parameters of `generated` it does not have yet - appended to its own. */
  def addMissing(section: Seq[String], generated: Seq[String]): Seq[String] =
    val own     = params(section)
    val missing = params(generated).filterNot(p => own.exists(_.name == p.name))
    if missing.isEmpty then section
    else
      val start = section.indexWhere(_.matches("""\s*(?:final\s+)?case class \w+\(.*"""))
      val close = closing(section, start)
      if start < 0 then section
      else if close < 0 then
        // `case class InConfig()` - on one line
        val head = section(start).replaceFirst("""\(\)(.*)$""", "(")
        val tail = section(start).replaceFirst("""^.*\(\)""", "  )")
        section.patch(start, (head +: withCommas(missing.map(_.lines))) :+ tail, 1)
      else
        val last    = (start + 1 until close).filter(j => isCode(section(j))).lastOption
        val withEnd = last match
          case Some(j) if !section(j).trim.endsWith(",") => section.updated(j, section(j) + ",")
          case _                                         => section
        withEnd.patch(close, withCommas(missing.map(_.lines)), 0)
      end if
  end addMissing

  /** The fields that `generated` adds to `own` and that have no default - with their argument in
    * the `lazy val example = X(…)` of `generated` added to the example of `section` (a field with
    * a default is fine without). Without an example in `section` or `generated` nothing changes.
    */
  def addMissingToExample(section: Seq[String], own: Seq[String], generated: Seq[String], name: String): Seq[String] =
    val ownNames = params(own).map(_.name).toSet
    val required = params(generated).filterNot(p => ownNames.contains(p.name)).filterNot(hasDefault).map(_.name)
    val genArgs  = exampleArgs(generated, name)
    val toAdd    = required.flatMap(n => genArgs.find(_.name == n))
    val start    = exampleStart(section, name)
    if toAdd.isEmpty || start < 0 then section
    else if section(start).trim.endsWith(s"$name()") then
      // `lazy val example = InitIn()` - on one line
      val indent = section(start).takeWhile(_ == ' ')
      section.patch(
        start,
        (section(start).stripSuffix("()") + "(") +: withCommas(toAdd.map(_.lines)) :+ s"$indent)",
        1
      )
    else
      val close = closing(section, start)
      if close < 0 then section
      else
        val args    = exampleArgs(section, name)
        val last    = (start + 1 until close).filter(j => isCode(section(j))).lastOption
        val withEnd = last match
          case Some(j) if args.nonEmpty && !section(j).trim.endsWith(",") => section.updated(j, section(j) + ",")
          case _                                                         => section
        withEnd.patch(close, withCommas(toAdd.map(_.lines)), 0)
    end if
  end addMissingToExample

  private def exampleStart(section: Seq[String], name: String): Int =
    section.indexWhere(_.matches(s"""\\s*lazy val example\\s*=\\s*$name\\(.*"""))

  /** The named arguments of `lazy val example = X(…)` - each with its lines. */
  private def exampleArgs(section: Seq[String], name: String): Seq[Param] =
    val start = exampleStart(section, name)
    val close = if start < 0 || section(start).trim.endsWith(s"$name()") then -1 else closing(section, start)
    if close < 0 then Seq.empty
    else
      split(section.slice(start + 1, close)).flatMap: ls =>
        ls.collectFirst { case l if l.matches("""\s*\w+\s*=.*""") => l.trim.takeWhile(c => c.isLetterOrDigit || c == '_') }
          .map(Param(_, withoutComma(ls.reverse.dropWhile(_.isBlank).reverse)))

  // from the line with the name on - the annotations before it (`@description("a = b")`) do not count
  private def hasDefault(p: Param): Boolean =
    p.lines.dropWhile(l => !l.matches("""\s*\w+\s*:.*""")).filter(isCode).mkString(" ")
      .matches("""(?s)\s*\w+\s*:[^=]*=.*""")

  case class Param(name: String, lines: Seq[String])

  /** The parameters between `case class X(` and its closing `)`. */
  def params(section: Seq[String]): Seq[Param] =
    val start = section.indexWhere(_.matches("""\s*(?:final\s+)?case class \w+\(.*"""))
    val close = closing(section, start)
    if start < 0 || close < 0 then Seq.empty
    else
      split(section.slice(start + 1, close)).flatMap: ls =>
        ls.collectFirst { case l if l.matches("""\s*\w+\s*:.*""") => l.trim.takeWhile(c => c.isLetterOrDigit || c == '_') }
          .map(Param(_, withoutComma(ls.reverse.dropWhile(_.isBlank).reverse)))
  end params

  // a parameter (an argument) ends with the comma at depth 0 - its annotations and comments come before it
  private def split(lines: Seq[String]): Seq[Seq[String]] =
    lines.foldLeft((Vector.empty[Seq[String]], Vector.empty[String], 0)):
      case ((done, current, depth), line) =>
        val d = depth + balance(line)
        if d == 0 && isCode(line) && line.trim.endsWith(",") then (done :+ (current :+ line), Vector.empty, d)
        else (done, current :+ line, d)
    match
      case (done, rest, _) => done ++ Option.when(rest.exists(isCode))(rest)

  // the comma after the parameter - on its last line of code
  private def withoutComma(ls: Seq[String]): Seq[String] =
    val last = ls.lastIndexWhere(isCode)
    if last < 0 then ls else ls.updated(last, ls(last).stripSuffix(","))

  // the line with the `)` that closes the parameter list - on the same indentation as the start
  private def closing(section: Seq[String], start: Int): Int =
    if start < 0 || section(start).matches("""\s*(?:final\s+)?case class \w+\(\).*""") then -1
    else
      val indent = section(start).indexWhere(_ != ' ')
      section.indexWhere(l => l.indexWhere(_ != ' ') == indent && l.trim.startsWith(")"), start + 1)

  private def withCommas(params: Seq[Seq[String]]): Seq[String] =
    params.zipWithIndex.flatMap: (ls, i) =>
      if i == params.size - 1 then ls else ls.init :+ (ls.last + ",")

  private def isCode(l: String) = !l.isBlank && !l.trim.startsWith("//")

  // parentheses and brackets outside of strings
  private def balance(l: String): Int =
    l.replaceAll("\"(?:[^\"\\\\]|\\\\.)*\"", "").takeWhile(_ => true).split("//").head
      .foldLeft(0)((d, c) => if "([".contains(c) then d + 1 else if ")]".contains(c) then d - 1 else d)
end CaseClassParams

/** The imports a file already has - an import is not added again, nor one for a name that is
  * already imported (from somewhere else - that one wins) or visible through the package clause.
  */
object OrchSpecImports:
  private val Import = """import\s+([\w.]+)\.(\{[^}]*\}|\*|_|\w+)(?:\s+as\s+\w+)?\s*(?://.*)?""".r

  def covered(lines: Seq[String], importLine: String): Boolean =
    importLine.trim match
      case Import(prefix, selector) =>
        val packages = visiblePackages(lines)
        val existing = lines.map(_.trim).collect { case Import(p, sel) => (p, names(sel)) }
          .flatMap((p, ns) => (p +: packages.map(pkg => s"$pkg.$p")).map(_ -> ns))
        val wanted   = names(selector)
        packages.contains(prefix) && !wanted.contains("*") ||
        wanted.forall: n =>
          existing.exists((p, ns) => (p == prefix && (ns.contains(n) || ns.contains("*"))) || (n != "*" && ns.contains(n)))
      case _                        => lines.exists(_.trim == importLine.trim)

  private def names(selector: String): Seq[String] =
    selector.stripPrefix("{").stripSuffix("}").split(",").toSeq.map(_.trim.split("\\s+").head)
      .map(n => if n == "_" then "*" else n).filter(_.nonEmpty)

  // `package valiant.product` + `package domain.orderCard.v1` - both are visible without import
  private def visiblePackages(lines: Seq[String]): Seq[String] =
    lines.takeWhile(l => !l.startsWith("object ") && !l.startsWith("import "))
      .collect { case l if l.startsWith("package ") => l.stripPrefix("package ").trim }
      .scanLeft("")((acc, p) => if acc.isEmpty then p else s"$acc.$p").drop(1)
end OrchSpecImports

object OrchSpecGenerator:
  /** Where a diagram goes: a C8 export to the C8 path, any other to the project's own engine (C7
    * or Op) - an export of the other engine than the project's falls back to that engine's default.
    */
  def processTypeOf(projectType: BpmnProcessType, c8: Boolean): BpmnProcessType =
    if c8 then
      projectType match
        case c8: BpmnProcessType.C8 => c8
        case _                      => BpmnProcessType.C8()
    else
      projectType match
        case _: BpmnProcessType.C8 => BpmnProcessType.C7()
        case other                 => other
end OrchSpecGenerator
