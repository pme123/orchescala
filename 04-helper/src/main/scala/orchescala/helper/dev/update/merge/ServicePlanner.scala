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
  */
case class ServicePlanner(project: os.Path)(using config: DevConfig):

  /** @throws IllegalArgumentException if the export has no domain classes or is of another project */
  def plan(e: ServicesExport): ProcessFiles =
    val notes                      = Seq.newBuilder[String]
    val files                      = OrchSpecExport.parse(e.scala)
    val (workerFiles, domainFiles) = files.partition(_.path.segments.headOption.exists(_.endsWith("worker")))
    if domainFiles.isEmpty then
      throw IllegalArgumentException("No service classes in the export - nothing to create.")
    val workersByApi               = workerFiles.groupBy(f => ServicePlanner.apiOfDir(f.path / os.up))

    val perApi = domainFiles.groupBy(ServicePlanner.apiDir).toSeq.sortBy(_._1.toString).map:
      (exportDomainDir, apiFiles) =>
        val (apiName, versionNr) = apiAndVersion(packageOf(exportDomainDir))
        val version              = Some(versionNr)
        val domainDir            = BpmnGenerator().domainRel(apiName, version)
        val domain               = apiFiles.map: file =>
          GeneratedFile(domainDir / file.path.relativeTo(exportDomainDir), FileKind.Export, file.content)
        val apiWorkerFiles       = workersByApi.getOrElse(apiName -> s"v$versionNr", Seq.empty)
        val workerDir            = ModuleConfig.workerModule.packagePath(config.projectPath) / apiName / version.versionPath
        val workers              = apiWorkerFiles.map: file =>
          GeneratedFile(workerDir / file.path.last, FileKind.Scaffold, file.content)
        val workerNames          = apiWorkerFiles.map(_.path.last.stripSuffix(".scala")).filter(_.endsWith("Worker"))
        (domain ++ workers, ServicePlanner.registrations(apiName, versionNr, workerNames))

    // workers of an API without domain classes in the export - nothing to put them next to
    val apis = domainFiles.map(f => ServicePlanner.apiOfDir(ServicePlanner.apiDir(f))).toSet
    for (api, version) <- workersByApi.keySet.toSeq.sorted if !apis.contains(api -> version) do
      notes += s"WARNING: workers of $api.$version without its domain in the export - not created."

    ProcessFiles(perApi.flatMap(_._1), perApi.flatMap(_._2), notes.result())
  end plan

  private def packageOf(dir: os.RelPath): String =
    dir.segments.dropWhile(_ != "scala").drop(1).mkString(".")

  // `<projectPackage>.domain.<api>.v<version>` - the package Orch Spec derives from the API
  private def apiAndVersion(pkg: String): (String, Int) =
    val Expected = s"""${java.util.regex.Pattern.quote(config.projectPackage)}\\.domain\\.(\\w+)\\.v(\\d+)""".r
    pkg match
      case Expected(api, version) => api -> version.toInt
      case other                  =>
        throw IllegalArgumentException(
          s"""The package of the export '$other' does not belong to this project.
             |Expected: ${config.projectPackage}.domain.<api>.v<version>
             |Check company and project of the services in Orch Spec.""".stripMargin
        )
    end match
  end apiAndVersion

end ServicePlanner

object ServicePlanner:

  /** The directory of an API - its types are one level below, in `schema/`. */
  private[merge] def apiDir(file: OrchSpecFile): os.RelPath =
    val dir = file.path / os.up
    if dir.last == "schema" then dir / os.up else dir

  /** `.../client/v1` - the last two directories name the API and its version. */
  private[merge] def apiOfDir(dir: os.RelPath): (String, String) = (dir / os.up).last -> dir.last

  /** The block of an API in the `WorkerApp` and its group in the API documentation - the super
    * trait names them (`clientV1`, `ClientV1`). A collection and an orchestration of the same API
    * give the same blocks; the merge joins their entries.
    */
  def registrations(apiName: String, versionNr: Int, workers: Seq[String])(using config: DevConfig): Seq[Registration] =
    val versionPackage = Some(versionNr).versionPackage
    val versionTag     = s"V$versionNr"
    val block          = s"$apiName$versionTag"
    val group          = s"${apiName.head.toUpper}${apiName.tail}$versionTag"
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
