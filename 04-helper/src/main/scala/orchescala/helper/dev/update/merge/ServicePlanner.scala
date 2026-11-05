package orchescala.helper.dev.update.merge

import orchescala.helper.dev.update.*

/** Decides which files a service collection or a service orchestration of the export gives in the
  * project - the logic of «processFromSpec» for services, without writing or printing anything.
  *
  * Per API of the export (`client.v1`, `crm.v2`): in the domain the super trait, one ServiceTask
  * (or CustomTask of an orchestration) per service and the types of the API (`schema/`) - merged
  * like the domain classes of a process; in the worker module `serviceBasePath` and one worker
  * per service - a skeleton for the developer: created once, then 3-way. The workers of an API
  * go into the `WorkerApp` (`clientV1Workers`), its services as a group into the API
  * documentation (`clientV1Api`).
  *
  * A nested API (`clientMaster.naturalPersons`) gets its levels as directories; the classes the
  * APIs of a level share come in `clientMaster/schema/` - merged like the domain classes.
  */
case class ServicePlanner(project: os.Path)(using config: DevConfig):

  /** @throws IllegalArgumentException if the export has no domain classes or is of another project */
  def plan(e: ServicesExport): ProcessFiles =
    val notes                      = Seq.newBuilder[String]
    val files                      = OrchSpecExport.parse(e.scala)
    val (workerFiles, domainFiles) = files.partition(_.path.segments.headOption.exists(_.endsWith("worker")))
    if domainFiles.isEmpty then
      throw IllegalArgumentException("No service classes in the export - nothing to create.")
    val workersByApi               = workerFiles.groupBy(f => apiAndVersion(packageOf(f.path / os.up), "worker"))
    // the classes the APIs of a level share (`clientMaster/schema/`) - no API of their own
    val (sharedFiles, apiFiles)    = domainFiles.partition(f => ServicePlanner.isSharedSchema(f.path / os.up))

    val perApi = apiFiles.groupBy(ServicePlanner.apiDir).toSeq.sortBy(_._1.toString).map:
      (exportDomainDir, apiFiles) =>
        val (apiName, versionNr) = apiAndVersion(packageOf(exportDomainDir), "domain")
        val version              = Some(versionNr)
        val domainDir            =
          if apiName.contains('.') then domainRoot / ServicePlanner.levels(apiName) / version.versionPath
          else BpmnGenerator().domainRel(apiName, version)
        val domain               = apiFiles.map: file =>
          GeneratedFile(domainDir / file.path.relativeTo(exportDomainDir), FileKind.Export, file.content)
        val apiWorkerFiles       = workersByApi.getOrElse(apiName -> versionNr, Seq.empty)
        // the worker in the main sources, its test (`03-worker/src/test/…`) in the test sources
        def workerDir(file: OrchSpecFile) =
          ModuleConfig.workerModule.packagePath(config.projectPath, mainOrTest = ServicePlanner.sourceSet(file)) /
            ServicePlanner.levels(apiName) / version.versionPath
        val workers              = apiWorkerFiles.map: file =>
          GeneratedFile(workerDir(file) / file.path.last, FileKind.Scaffold, file.content)
        val workerNames          = apiWorkerFiles.map(_.path.last.stripSuffix(".scala")).filter(_.endsWith("Worker"))
        (domain ++ workers, ServicePlanner.registrations(apiName, versionNr, workerNames))

    val shared = sharedFiles.map: file =>
      val level = levelOf(packageOf(file.path / os.up / os.up))
      GeneratedFile(domainRoot / ServicePlanner.levels(level) / "schema" / file.path.last, FileKind.Export, file.content)

    // workers of an API without domain classes in the export - nothing to put them next to
    val apis = apiFiles.map(f => apiAndVersion(packageOf(ServicePlanner.apiDir(f)), "domain")).toSet
    for (api, version) <- workersByApi.keySet.toSeq.sorted if !apis.contains(api -> version) do
      notes += s"WARNING: workers of $api.v$version without its domain in the export - not created."

    ProcessFiles(perApi.flatMap(_._1) ++ shared, perApi.flatMap(_._2), notes.result())
  end plan

  private def domainRoot: os.RelPath = ModuleConfig.domainModule.packagePath(config.projectPath)

  private def packageOf(dir: os.RelPath): String =
    dir.segments.dropWhile(_ != "scala").drop(1).mkString(".")

  private def notOfProject(pkg: String, expected: String) =
    IllegalArgumentException(
      s"""The package of the export '$pkg' does not belong to this project.
         |Expected: ${config.projectPackage}.$expected
         |Check company and project of the services in Orch Spec.""".stripMargin
    )

  // `<projectPackage>.<module>.<api>.v<version>` - the package Orch Spec derives from the API;
  // a nested API has its levels: `<projectPackage>.domain.clientMaster.naturalPersons.v1`
  private def apiAndVersion(pkg: String, module: String): (String, Int) =
    val Expected = s"""${java.util.regex.Pattern.quote(config.projectPackage)}\\.$module\\.(\\w+(?:\\.\\w+)*)\\.v(\\d+)""".r
    pkg match
      case Expected(api, version) => api -> version.toInt
      case other                  => throw notOfProject(other, s"$module.<api>.v<version>")
  end apiAndVersion

  // `<projectPackage>.domain.clientMaster` - a level of nested APIs
  private def levelOf(pkg: String): String =
    val Expected = s"""${java.util.regex.Pattern.quote(config.projectPackage)}\\.domain\\.(\\w+(?:\\.\\w+)*)""".r
    pkg match
      case Expected(level) => level
      case other           => throw notOfProject(other, "domain.<level>.schema")
  end levelOf

end ServicePlanner

object ServicePlanner:

  /** The directory of an API - its types are one level below, in `schema/`. */
  private[merge] def apiDir(file: OrchSpecFile): os.RelPath =
    val dir = file.path / os.up
    if dir.last == "schema" then dir / os.up else dir

  private val Version = "v\\d+".r

  /** `main` or `test` - `03-worker/src/test/scala/…/GetClientWorkerTest.scala` is a test. */
  private[merge] def sourceSet(file: OrchSpecFile): String =
    if file.path.segments.lift(2).contains("test") then "test" else "main"

  /** `clientMaster/schema` - the shared classes of a level: a `schema/` not inside a version. */
  private[merge] def isSharedSchema(dir: os.RelPath): Boolean =
    dir.last == "schema" && !Version.matches((dir / os.up).last)

  /** `clientMaster.naturalPersons` → `clientMaster/naturalPersons` */
  private[merge] def levels(api: String): os.RelPath = os.RelPath(api.split('.').mkString("/"))

  /** The block of an API in the `WorkerApp` and its group in the API documentation - the super
    * trait names them (`clientV1`, `ClientV1`). A collection and an orchestration of the same API
    * give the same blocks; the merge joins their entries.
    */
  def registrations(apiName: String, versionNr: Int, workers: Seq[String])(using config: DevConfig): Seq[Registration] =
    val versionPackage = Some(versionNr).versionPackage
    val versionTag     = s"V$versionNr"
    // a nested API is named by its last part, as its super trait (`naturalPersonsV1`)
    val name           = apiName.split('.').last
    val block          = s"$name$versionTag"
    val group          = s"${name.head.toUpper}${name.tail}$versionTag"
    val services       = workers.map(_.stripSuffix("Worker"))
    Seq(
      Registration(
        ModuleConfig.workerModule.packagePath(config.projectPath) / "WorkerApp.scala",
        OrchSpecRegistration(
          "WorkerApp",
          "workers(",
          s"${block}Workers",
          workers.map(w => s"$w()"),
          entries =>
            s"""  private lazy val ${block}Workers =
               |    import ${config.projectPackage}.worker.$apiName$versionPackage.*
               |    Seq(
               |${entries.map(e => s"      $e,").mkString("\n")}
               |    )
               |  end ${block}Workers""".stripMargin
        )
      ),
      Registration(
        ModuleConfig.apiModule.packagePath(config.projectPath) / "ApiProjectCreator.scala",
        OrchSpecRegistration(
          "ApiProjectCreator",
          "document(",
          s"${block}Api",
          services.map(s => s"$s.example"),
          entries =>
            s"""  private lazy val ${block}Api =
               |    import ${config.projectPackage}.domain.$apiName$versionPackage.*
               |    group("$group")(
               |${entries.map(e => s"      $e,").mkString("\n")}
               |    )
               |  end ${block}Api""".stripMargin
        )
      )
    )
  end registrations

end ServicePlanner
