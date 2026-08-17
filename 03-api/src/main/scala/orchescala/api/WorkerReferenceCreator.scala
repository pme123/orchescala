package orchescala.api

import orchescala.domain.{InOutType, shortenName}

/** Checks all Worker classes (Scala sources) of all Projects, if a Worker is composed of other
  * Workers. As result lists are created that can be included in the Documentation.
  *
  * A Worker _uses_ another Worker, if it takes it as a Constructor parameter:
  * {{{
  * class CancelCreateAndSignDocumentWorker(
  *     getProcessInstanceWorker: GetProcessInstanceWorker,
  *     postSignalWorker: PostSignalWorker
  * ) extends CompanyCustomWorkerDsl[In, Out]
  * }}}
  *
  * The Topic of a Worker is taken from the Domain Object it imports (`topicName` / `processName`),
  * so it can be linked to its Documentation.
  */
trait WorkerReferenceCreator:

  protected def apiConfig: ApiConfig
  protected def gitBasePath: os.Path
  protected def docProjectUrl(project: String): String

  /** The Workers the Worker with this `topicName` is composed of. */
  protected def usesWorkers(topicName: String): Seq[WorkerRef] =
    workerCompositions
      .filter(_.ref.topicName.contains(topicName))
      .flatMap(_.usedWorkers)
      .distinctBy(_.fullClassName)
      .sortBy(w => w.projectName -> w.className)

  /** The Workers that are composed of the Worker with this `topicName`. */
  protected def usedByWorkers(topicName: String): Seq[WorkerRef] =
    workerCompositions
      .filter(_.usedWorkers.exists(_.topicName.contains(topicName)))
      .map(_.ref)
      .distinctBy(_.fullClassName)
      .sortBy(w => w.projectName -> w.className)

  case class WorkerRef(
      projectName: String,
      packageName: String,
      className: String,
      topicName: Option[String]
  ):
    lazy val fullClassName: String = s"$packageName.$className"

    lazy val asString: String =
      topicName
        .map: topic =>
          val identShort = shortenName(topic)
          val anchor     = s"#operation/${InOutType.Worker}:%20$identShort"
          s"_[${InOutType.Worker}: $identShort](${docProjectUrl(projectName)}/OpenApi.html$anchor)_"
        .getOrElse(s"_${InOutType.Worker}: ${className}_")
  end WorkerRef

  case class WorkerComposition(ref: WorkerRef, usedWorkers: Seq[WorkerRef])

  /** All Workers of all Projects with the Workers they are composed of. */
  lazy val workerCompositions: Seq[WorkerComposition] =
    val compositions = workerSources
      .map: ws =>
        WorkerComposition(
          workerRef(ws),
          ws.constructorWorkers.map(resolveWorker(ws, _))
        )
    println(
      s"Worker Compositions: ${compositions.count(_.usedWorkers.nonEmpty)} of ${compositions.size} Workers"
    )
    compositions
  end workerCompositions

  private def workerRef(ws: WorkerSource): WorkerRef =
    WorkerRef(ws.projectName, ws.packageName, ws.className, topicName(ws))

  /** Resolves the Worker of a Constructor parameter - either with the import or in the same
    * package. If it is not in one of the configured Projects (e.g. a Worker of another company),
    * only the class name is known.
    */
  private def resolveWorker(ws: WorkerSource, className: String): WorkerRef =
    val candidates   =
      ws.imports.get(className).toSeq ++
        (s"${ws.packageName}.$className" +: ws.wildcardImports.map(p => s"$p.$className"))
    val uniqueByName =
      workerSources.filter(_.className == className) match
        case Seq(unique) => Some(unique)
        case _           => None
    val workerSource = candidates
      .flatMap(workerSourcesByClassName.get)
      .headOption
      .orElse(uniqueByName)
    workerSource
      .map(workerRef)
      .getOrElse:
        val packageName = ws.imports.getOrElse(className, className).stripSuffix(s".$className")
        WorkerRef(projectNameOfPackage(packageName), packageName, className, None)
  end resolveWorker

  private def projectNameOfPackage(packageName: String): String =
    packageName.split("\\.").takeWhile(p => p != "worker" && p != "domain").mkString("-")

  /** The Topic of the Worker - taken from the Domain Object it imports. */
  private def topicName(ws: WorkerSource): Option[String] =
    ws.domainObjectRefs
      .flatMap: ref =>
        domainIdentifiers
          .get(ref)
          .filter(_.projectName == ws.projectName)
          .orElse(domainIdentifierOfRelativeRef(ws.projectName, ref))
      .map(_.identifier)
      .headOption

  /** A relative import like `import domain.myProcess.MyWorker.*` in `package my.project`. */
  private def domainIdentifierOfRelativeRef(
      projectName: String,
      ref: String
  ): Option[DomainIdentifier] =
    domainIdentifiers
      .collect:
        case name -> ident if name.endsWith(s".$ref") && ident.projectName == projectName =>
          ident
      .toSeq match
      case Seq(unique) => Some(unique)
      case _           => None

  private lazy val workerSourcesByClassName: Map[String, WorkerSource] =
    workerSources.map(ws => ws.fullClassName -> ws).toMap

  private lazy val workerSources: Seq[WorkerSource] =
    println(s"Worker Reference Base Directory: $gitBasePath")
    apiConfig.projectsConfig.projectConfigs
      .flatMap: pc =>
        println(s"Get Workers in ${pc.name}")
        scalaFiles(pc.absGitPath(gitBasePath), workerModule)
          .filter(_.last.endsWith("Worker.scala"))
          .flatMap(parseWorker(pc.name, _))
  end workerSources

  private lazy val domainIdentifiers: Map[String, DomainIdentifier] =
    apiConfig.projectsConfig.projectConfigs
      .flatMap: pc =>
        scalaFiles(pc.absGitPath(gitBasePath), domainModule)
          .flatMap(parseDomainIdentifiers(pc.name, _))
      .toMap

  private def parseWorker(projectName: String, path: os.Path): Option[WorkerSource] =
    val content     = os.read(path)
    val packageName = packagePattern.findAllMatchIn(content).map(_.group(1)).mkString(".")
    val classes     = classPattern.findAllMatchIn(content).map(m => m.group(1) -> m.start).toSeq
    classes
      .find(_._1 == path.baseName)
      .orElse(classes.headOption)
      .map { case (className, start) =>
        WorkerSource(
          projectName = projectName,
          packageName = packageName,
          className = className,
          imports = importedClasses(content),
          wildcardImports = wildcardImports(content),
          domainObjectRefs = domainObjectRefs(content),
          constructorWorkers = constructorWorkers(content.substring(start))
        )
      }
  end parseWorker

  /** The Worker classes of the Constructor parameters - the part before `extends`. */
  private def constructorWorkers(classDeclaration: String): Seq[String] =
    val declaration = classDeclaration.indexOf("extends") match
      case -1    => classDeclaration.take(1000)
      case index => classDeclaration.take(index)
    declaration.indexOf('(') match
      case -1    => Seq.empty
      case index =>
        workerParamPattern
          .findAllMatchIn(declaration.substring(index))
          .map(_.group(1))
          .toSeq
          .distinct
  end constructorWorkers

  private def importedClasses(content: String): Map[String, String] =
    val multi  = importMultiPattern
      .findAllMatchIn(content)
      .flatMap: m =>
        m.group(2)
          .split(",")
          .map(_.trim.split(" as ").head.trim)
          .filter(name => name.nonEmpty && name.head.isLetter)
          .map(name => name -> s"${m.group(1)}.$name")
      .toMap
    val single = importSinglePattern
      .findAllMatchIn(content)
      .map(m => m.group(2) -> s"${m.group(1)}.${m.group(2)}")
      .toMap
    multi ++ single
  end importedClasses

  private def wildcardImports(content: String): Seq[String] =
    importWildcardPattern.findAllMatchIn(content).map(_.group(1)).toSeq

  /** All imported Objects that could be the Domain Object of the Worker. */
  private def domainObjectRefs(content: String): Seq[String] =
    (wildcardImports(content) ++
      importSinglePattern.findAllMatchIn(content).map(m => s"${m.group(1)}.${m.group(2)}") ++
      importMultiPattern.findAllMatchIn(content).map(_.group(1)))
      .filter(ref => ref.contains(".domain.") || ref.startsWith("domain."))
      .distinct

  private def parseDomainIdentifiers(
      projectName: String,
      path: os.Path
  ): Seq[(String, DomainIdentifier)] =
    val content = os.read(path)
    if !content.contains("topicName") && !content.contains("processName") then
      Seq.empty
    else
      val packageName = packagePattern.findAllMatchIn(content).map(_.group(1)).mkString(".")
      val objects     = objectPattern.findAllMatchIn(content).map(m => m.start -> m.group(1)).toSeq
      identifierPattern
        .findAllMatchIn(content)
        .flatMap: m =>
          objects
            .filter(_._1 < m.start)
            .lastOption
            .map: objectRef =>
              s"$packageName.${objectRef._2}" -> DomainIdentifier(projectName, m.group(1))
        .toSeq
    end if
  end parseDomainIdentifiers

  private def scalaFiles(projectPath: os.Path, module: String): Seq[os.Path] =
    val modulePath = projectPath / module
    if !os.exists(modulePath) then
      Seq.empty
    else
      os.walk(modulePath, skip = _.last == "target")
        .filter(_.ext == "scala")
        .filter(_.toString.contains("/src/main/scala/"))
  end scalaFiles

  private case class WorkerSource(
      projectName: String,
      packageName: String,
      className: String,
      // class name -> full class name
      imports: Map[String, String],
      wildcardImports: Seq[String],
      domainObjectRefs: Seq[String],
      constructorWorkers: Seq[String]
  ):
    lazy val fullClassName: String = s"$packageName.$className"

  private case class DomainIdentifier(projectName: String, identifier: String)

  private lazy val domainModule = "01-domain"
  private lazy val workerModule = "03-worker"

  private lazy val packagePattern        = """(?m)^package\s+([\w.]+)\s*$""".r
  private lazy val classPattern          = """(?m)^(?:abstract\s+)?class\s+(\w+Worker)\b""".r
  private lazy val workerParamPattern    = """:\s*([A-Z]\w*Worker)\b""".r
  private lazy val importWildcardPattern = """(?m)^import\s+([\w.]+)\.\*\s*$""".r
  private lazy val importSinglePattern   = """(?m)^import\s+([\w.]+)\.(\w+)\s*$""".r
  private lazy val importMultiPattern    = """(?m)^import\s+([\w.]+)\.\{([^}]*)\}""".r
  private lazy val objectPattern         = """(?m)^object\s+(\w+)\b""".r
  private lazy val identifierPattern    =
    """(?m)^\s*(?:final\s+)?(?:lazy\s+)?val\s+(?:topicName|processName)\s*(?::\s*String)?\s*=\s*"([^"]+)"""".r
end WorkerReferenceCreator
