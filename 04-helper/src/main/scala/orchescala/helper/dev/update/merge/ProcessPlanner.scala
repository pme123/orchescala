package orchescala.helper.dev.update.merge

import orchescala.domain.BpmnProcessType
import orchescala.helper.dev.update.*

/** One entry of the export - a process or services; `slug` names its file in the spec folder. */
sealed trait SpecEntry:
  def slug: String

/** One process of the export - what «Process from Spec» gives (`orchspec:` v1): the BPMN for the
  * engine of the process, the Scala classes, the DMN tables (file name -> XML).
  */
case class ProcessExport(
    slug: String,
    bpmn: Option[String],
    scala: String,
    dmns: Seq[(String, String)] = Seq.empty
) extends SpecEntry

/** A service collection or a service orchestration of the export (`orchspec:` v2) - the Scala
  * files of its APIs, domain and worker (see `ServicePlanner`).
  */
case class ServicesExport(slug: String, scala: String) extends SpecEntry

/** How a generated file is merged (see `SpecMerge.decide`). */
enum FileKind:
  /** the domain classes of the export, BPMN and DMN - 3-way */
  case Export
  /** the process object - 3-way; without a base the types are merged by structure (as before) */
  case ProcessObject
  /** a skeleton for the developer (worker, its test, the template BPMN) - created once; then
    * 3-way, so a changed topic or In/Out arrives. Without a base an existing one stays.
    */
  case Scaffold
  /** the simulation - as it is to be given the code (a split for the other engine), see
    * `SimulationGenerator.simulationFiles`
    */
  case Simulation

/** A file created from the export - relative to the project.
  * @param structural the merge by structure into the code (process object: the types from Orch Spec)
  * @param pristine   the file as created for a new project - the simulation is compared with it
  *                   when its process goes (its `content` follows the code)
  */
case class GeneratedFile(
    rel: os.RelPath,
    kind: FileKind,
    content: String,
    structural: Option[String => String] = None,
    pristine: Option[String] = None
)

/** The entries of a process in the `WorkerApp` or the `ApiProjectCreator`. */
case class Registration(file: os.RelPath, registration: OrchSpecRegistration)

/** What a process brings into the project: its files, its registrations and what to tell. */
case class ProcessFiles(files: Seq[GeneratedFile], registrations: Seq[Registration], notes: Seq[String])

/** Decides which files a process of the export gives in the project - the logic of
  * «processFromSpec» (domain classes, process object, BPMN, DMN, workers, simulation,
  * registrations), without writing or printing anything. The code of the project is only read
  * where the result depends on it (the name of the process object, the form of the simulation).
  */
case class ProcessPlanner(project: os.Path)(using config: DevConfig):

  private def read(rel: os.RelPath): Option[String] =
    Option.when(os.isFile(project / rel))(os.read(project / rel))
  private def names(rel: os.RelPath): Seq[String]   =
    if os.isDir(project / rel) then os.list(project / rel).map(_.last) else Seq.empty

  /** @throws IllegalArgumentException if the export does not belong to the project or is empty */
  def plan(e: ProcessExport): ProcessFiles =
    val notes                     = Seq.newBuilder[String]
    val files                     = OrchSpecExport.parse(e.scala)
    val (processFile, classFiles) = files.partition(_.insert)
    val bpmnProcessId             = e.bpmn.flatMap(OrchSpecExport.processId)
    val fromBpmn                  = bpmnProcessId.map(OrchSpecNames(_, config.projectName))
    // the package is in the exported classes - so they decide, if there are any
    val fromExport                = Option.when(files.nonEmpty):
      val (processName, version) = processAndVersion(packageOf(OrchSpecExport.processDir(files)))
      val dir                    = BpmnGenerator().domainRel(processName, Some(version))
      // Orch Spec names the file after the object it knows from the domain - that one counts only
      // while its file exists; otherwise the name follows the process (the version is in the package)
      val exported               = processFile.headOption.map(_.path.last.stripSuffix(".scala"))
      val objectName             = OrchSpecNames.objectName(
        exported,
        fromBpmn.filter(_.processName == processName).map(_.objectName)
          .getOrElse(s"${processName.head.toUpper}${processName.tail}"),
        name => os.exists(project / dir / s"$name.scala")
      )
      for ex <- exported if ex != objectName do
        notes += s"$ex.scala does not exist (any more) - the process object is $objectName."
      OrchSpecNames(processName, version, objectName)
    for b <- fromBpmn; x <- fromExport if b != x do
      notes += s"WARNING: The BPMN (${bpmnProcessId.mkString}) gives $b, the Scala classes $x - the Scala classes are taken."
    val OrchSpecNames(processName, versionNr, objectName) = fromExport.orElse(fromBpmn).getOrElse:
      throw IllegalArgumentException("Neither a BPMN with a process id nor Scala classes - nothing to create.")
    val version                   = Some(versionNr)
    val pkg                       = s"${config.projectPackage}.domain.$processName.v$versionNr"
    val setupElement              = SetupElement("Process", processName, objectName, version)
    val domainDir                 = BpmnGenerator().domainRel(processName, version)
    val hasSchema                 = classFiles.exists(_.path.segments.contains("schema"))
    val schemaImport              = s"import $pkg.schema.*"
    val processId                 = bpmnProcessId.getOrElse(setupElement.identifier)

    // objects of another project (a custom task whose topic is not of this process) exist there
    // already - neither their domain object nor their worker is created here
    val (ownFiles, foreignFiles) = classFiles.partition(f => !OrchSpecExport.isForeign(f.content, processId))
    foreignFiles.flatMap(f => OrchSpecExport.interaction(f.content).map(_._1 -> OrchSpecExport.topicName(f.content)))
      .foreach: (name, topic) =>
        notes += s"$name (${topic.getOrElse("-")}) is not of $processId - exists in its project, not created."

    // domain
    val domain        = ownFiles.map: file =>
      val inSchema = file.path.segments.contains("schema")
      GeneratedFile(
        domainDir / file.path.relativeTo(OrchSpecExport.processDir(files)),
        FileKind.Export,
        if hasSchema && !inSchema then OrchSpecExport.withImport(file.content, schemaImport) else file.content
      )
    val processObject = OrchSpecProcessObject(
      pkg,
      objectName,
      processId,
      processFile.headOption.map(_.content).getOrElse(""),
      Option.when(hasSchema)(schemaImport)
    )
    notes ++= processObject.warnings.map(w => s"WARNING: $w")
    val objectFile    = GeneratedFile(
      domainDir / s"$objectName.scala",
      FileKind.ProcessObject,
      processObject.content,
      // only what comes from Orch Spec is merged - the rest of the process object is implementation
      structural = Some(processObject.merge)
    )

    // bpmn - its engine decides where the diagrams go (camunda or camunda8)
    def processTypeOf(c8: Boolean): BpmnProcessType =
      OrchSpecGenerator.processTypeOf(config.projectBpmnProcessType, c8)
    val diagram       = e.bpmn match
      case Some(xml) =>
        val name = processId.stripPrefix(s"${config.companyName}-")
        GeneratedFile(processTypeOf(OrchSpecExport.isC8(xml)).diagramPath / s"$name.bpmn", FileKind.Export, xml)
      case None      =>
        val generator = BpmnProcessGenerator(config.projectBpmnProcessType)
        GeneratedFile(generator.bpmnRel(setupElement), FileKind.Scaffold, generator.bpmn(setupElement))
    // the tables of the DMN decisions - next to the BPMN (without a BPMN: the engine of the DMN)
    val dmns          = e.dmns.map: (file, xml) =>
      val c8 = e.bpmn.map(OrchSpecExport.isC8).getOrElse(OrchSpecExport.isC8Dmn(xml))
      GeneratedFile(processTypeOf(c8).diagramPath / OrchSpecExport.dmnFileName(file), FileKind.Export, xml)

    // workers
    val workers       = WorkerGenerator()
    // not the example - that would run with its values; `???` fails, so it is clear what is to do
    val initIn        = processObject.customInit.getOrElse(if processObject.hasInitIn then "???" else "InitIn()")
      .replace("\n", "\n    ") // a multi-line expression goes on with the indentation of the method body
    val processWorker = Seq(
      GeneratedFile(workers.workerRel(setupElement), FileKind.Scaffold, workers.processWorker(initIn)(setupElement)),
      GeneratedFile(workers.workerTestRel(setupElement), FileKind.Scaffold, workers.processWorkerTest(initIn)(setupElement))
    )
    val interactions  = ownFiles.flatMap(f =>
      OrchSpecExport.interaction(f.content).map((name, dsl) => (name, dsl, OrchSpecExport.topicName(f.content)))
    )
    val customTasks   = OrchSpecExport.workerNames(interactions, processId)
    val taskWorkers   = customTasks.flatMap: name =>
      val element = SetupElement("CustomTask", processName, name, version)
      Seq(
        GeneratedFile(workers.workerRel(element), FileKind.Scaffold, workers.processElement(element)),
        GeneratedFile(workers.workerTestRel(element), FileKind.Scaffold, workers.processElementTest(element))
      )

    // simulation - in Camunda 8 (or next to one of the other engine) one class per engine
    val c8            = e.bpmn.exists(OrchSpecExport.isC8)
    val simulation    = SimulationGenerator().simulationFiles(setupElement, c8, read, names)
    val fresh         = SimulationGenerator().simulationFiles(setupElement, c8, _ => None, _ => Seq.empty).files.toMap
    notes ++= simulation.notes
    val simulations   = simulation.files.map: (rel, content) =>
      GeneratedFile(rel, FileKind.Simulation, content, pristine = fresh.get(rel))

    // registration in the WorkerApp and the API documentation
    val versionPackage = version.versionPackage
    val registrations  = Seq(
      Registration(
        ModuleConfig.workerModule.packagePath(config.projectPath) / "WorkerApp.scala",
        OrchSpecRegistration(
          "WorkerApp",
          "workers(",
          s"${processName}Workers",
          (objectName +: customTasks).map(w => s"${w}Worker()"),
          entries =>
            s"""  private lazy val ${processName}Workers =
               |    import ${config.projectPackage}.worker.$processName$versionPackage.*
               |    Seq(
               |${entries.map(e => s"      $e,").mkString("\n")}
               |    )
               |  end ${processName}Workers""".stripMargin,
          Some(s"${config.projectPackage}.worker.$processName$versionPackage")
        )
      ),
      Registration(
        ModuleConfig.apiModule.packagePath(config.projectPath) / "ApiProjectCreator.scala",
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
    )

    ProcessFiles(
      (domain :+ objectFile :+ diagram) ++ dmns ++ processWorker ++ taskWorkers ++ simulations,
      registrations,
      notes.result()
    )
  end plan

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

end ProcessPlanner
