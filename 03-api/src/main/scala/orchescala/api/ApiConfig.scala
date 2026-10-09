package orchescala
package api

import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import sttp.apispec.openapi.Contact
import zio.{Runtime, Unsafe, ZIO}

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock
import scala.util.control.NonFatal
import scala.util.{Failure, Success, Try}

case class ApiConfig(
    engineConfig: EngineConfig,
    // your company name like 'mycompany'
    companyName: String,
    // contact email / phone, if there are questions
    contact: Option[Contact] = None,
    // REST endpoint (for testing API)
    endpoint: String = "http://localhost:8080/engine-rest",
    // Base Path of your project (if changed - all doc paths will be adjusted)
    basePath: os.Path = os.pwd,
    // If you work with JIRA, you can add matchers that will create automatically URLs to JIRA Tasks
    jiraUrls: Map[String, String] = Map.empty,
    // Configure your project setup
    projectsConfig: ProjectsConfig = ProjectsConfig(),
    // Configure your template generation
    modelerTemplateConfigs: Seq[ModelerTemplateConfig] = Seq(
      ModelerTemplateConfig(),
      ModelerTemplateConfig(
        supportedEngine = SupportedEngine.C8,
        templateRelativePath = os.rel / ".camunda" / "element-templates" / "c8"
      )
    ),
    // The URL of your published documentations
    // s"http://myCompany/bpmnDocs"
    docBaseUrl: Option[String] = None,
    // Path, where the Git Projects are cloned - for dependency check.
    // the default is for the structure: dev-myCompany/projects/myProject
    tempGitDir: os.Path = os.pwd / os.up / os.up / os.up / "git-temp",
    // Projects that are NOT part of this company's own catalog/docs, but must be scanned for
    // usages ("Used in ..." / "Uses ..." and worker compositions) - e.g. another company's
    // projects that call this company's workers (globex-* calling initech-core-banking). They are
    // cloned into tempGitDir like the own projects, but never show up in catalog or docs.
    referenceProjectsConfigs: Seq[ProjectsConfig] = Seq.empty,
    // Additionally scan every project checkout found in tempGitDir for usages - so another
    // company's projects calling this company's workers are found WITHOUT either company having
    // to list the other's projects in its config (no mutual config dependency). Only the usage
    // scans see them; catalog and docs stay strictly config-driven. Company meta-repos
    // (`*-orchescala`, `orchescala-*`) are skipped.
    scanTempGitDirForUsages: Boolean = true,
    // Markdown instructions for the company's own gateway (e.g. Globex's portal gateway instead of the
    // Orchescala gateway). If set, every project API gets a second collapsible
    // "<Company> Postman Instructions" with this text and a link to its PostmanOpenApi.yml -
    // and PostmanOpenApi.yml is published next to OpenApi.yml.
    companyPostmanInstructions: Option[String] = None
):
  val catalogPath: os.Path = basePath / catalogFileName

  lazy val openApiPath: os.Path             = basePath / ApiConfig.openApiPath
  lazy val postmanOpenApiPath: os.Path      = basePath / ApiConfig.postmanOpenApiPath
  lazy val openApiDocuPath: os.Path         = basePath / ApiConfig.openApiHtmlPath
  lazy val postmanOpenApiDocuPath: os.Path  = basePath / ApiConfig.postmanOpenApiHtmlPath
  lazy val tenantId: Option[String]         = engineConfig.tenantId
  lazy val projectGroups: Seq[ProjectGroup] = projectsConfig.projectConfigs
    .map(_.group)
    .distinct

  lazy val init: Unit =
    Unsafe.unsafe:
      implicit unsafe =>
        Runtime.default.unsafe.run(
          projectsConfig.init(tempGitDir, companyName, engineConfig.parallelism) *>
            ZIO.foreachDiscard(referenceProjectsConfigs)(
              _.init(tempGitDir, companyName, engineConfig.parallelism)
            )
        ).getOrThrow()

  end init

  def withTenantId(tenantId: String): ApiConfig =
    copy(engineConfig = engineConfig.withTenantId(tenantId))

  def withCompanyPostmanInstructions(markdown: String): ApiConfig =
    copy(companyPostmanInstructions = Some(markdown))

  def withBasePath(path: os.Path): ApiConfig =
    copy(
      basePath = path
    )

  def withEndpoint(ep: String): ApiConfig =
    copy(endpoint = ep)

  def withPort(port: Int): ApiConfig =
    copy(endpoint = s"http://localhost:$port/engine-rest")

  def withDocBaseUrl(url: String): ApiConfig =
    copy(docBaseUrl = Some(url))

  def withProjectsConfig(gitConfigs: ProjectsConfig): ApiConfig =
    copy(projectsConfig = gitConfigs)

  /** Projects scanned for usages only (see referenceProjectsConfigs) - e.g. the other company's
    * projects that call this company's workers. Not part of catalog or docs.
    */
  def withReferenceProjectsConfigs(configs: ProjectsConfig*): ApiConfig =
    copy(referenceProjectsConfigs = referenceProjectsConfigs ++ configs)

  def withModelerTemplateConfig(modelerTemplateConfig: ModelerTemplateConfig): ApiConfig =
    copy(modelerTemplateConfigs = modelerTemplateConfigs :+ modelerTemplateConfig)

  def addGitConfig(gitConfig: ProjectsPerGitRepoConfig): ApiConfig =
    copy(projectsConfig =
      projectsConfig.copy(perGitRepoConfigs = projectsConfig.perGitRepoConfigs :+ gitConfig)
    )

  def withJiraUrls(urls: (String, String)*): ApiConfig =
    copy(jiraUrls = urls.toMap)

  def addJiraUrl(jiraTag: String, url: String): ApiConfig =
    copy(jiraUrls = jiraUrls + (jiraTag -> url))

  def withContact(contact: Contact): ApiConfig =
    copy(contact = Some(contact))

  def refIdentShort(refIdent: String): String =
    projectsConfig.refIdentShort(refIdent, companyName)

  def refIdentShort(refIdent: String, projectName: String): String =
    projectsConfig.refIdentShort(refIdent, companyName, projectName)

  lazy val projectConfPath: os.Path = basePath / projectsConfig.projectConfPath
end ApiConfig
object ApiConfig:
  lazy val openApiPath: os.RelPath            = os.rel / "03-api" / "OpenApi.yml"
  lazy val postmanOpenApiPath: os.RelPath     = os.rel / "03-api" / "PostmanOpenApi.yml"
  lazy val openApiHtmlPath: os.RelPath        = os.rel / "03-api" / "OpenApi.html"
  lazy val postmanOpenApiHtmlPath: os.RelPath = os.rel / "03-api" / "PostmanOpenApi.html"
end ApiConfig

case class ProjectsConfig(
    // Path to your ApiProjectConf - default is os.pwd / PROJECT.conf
    projectConfPath: os.RelPath = defaultProjectConfigPath,
    // grouped configs per GitRepos - so it is possible to use projects from different Repos
    perGitRepoConfigs: Seq[ProjectsPerGitRepoConfig] = Seq.empty
):

  lazy val isConfigured: Boolean = perGitRepoConfigs.nonEmpty

  def withProjectConfPath(path: os.RelPath): ProjectsConfig =
    copy(projectConfPath = path)

  def projectCloneUrl(projectName: String): Option[String] =
    perGitRepoConfigs
      .find(_.containsProject(projectName))
      .map(_.cloneBaseUrl)

  def init(tempGitDir: os.Path, companyName: String, parallelism: Int) =
    ZIO.logInfo(s"Init Projects in $tempGitDir") *>
      ZIO.foreachPar(perGitRepoConfigs)(_.init(tempGitDir, companyName))
        .withParallelism(parallelism)
  end init

  def initProject(projectName: String, tempGitDir: os.Path, companyName: String): Unit =
    perGitRepoConfigs.foreach(_.initProject(tempGitDir, projectName, companyName))
  end initProject

  /** The company clone of a project in one repo for all, updated (once per run) - true if the project is
    * in such a repo. Only the clone: the docs export the project's folder at its tag from it.
    */
  def updateSingleRepoClone(projectName: String, tempGitDir: os.Path, companyName: String): Boolean =
    perGitRepoConfigs.find(c => c.singleRepo && c.containsProject(projectName)) match
      case Some(config) =>
        config.updateClone(tempGitDir, companyName, keepOnFailure = true)
        true
      case None         => false

  def projectConfig(projectName: String): Option[ProjectConfig] =
    projectConfigs.find(_.name == projectName)

  lazy val projectConfigs: Seq[ProjectConfig] = perGitRepoConfigs.flatMap(_.projects)

  lazy val colors: Seq[(String, String)] = projectConfigs.map { project =>
    project.name -> project.color
  }

  def colorForId(refName: String, ownProjectName: String): Option[(String, String)] =
    colors.find:
      case (id, _) => refName.startsWith(id) && !refName.startsWith(ownProjectName)

  def hasProjectGroup(
      projectName: String,
      projectGroup: ProjectGroup
  ): Boolean =
    perGitRepoConfigs
      .flatMap(_.projects)
      .find(_.name == projectName)
      .exists(_.group == projectGroup)

  def refIdentShort(refIdent: String, companyId: String, projectName: String): String =
    refIdent
      .replace(s"$companyId-", "") // mycompany-myproject-myprocess -> myproject-myprocess
      .replace(
        s"${projectName.replace(s"$companyId-", "")}-",
        ""
      )                            // myproject-myprocess -> myprocess
  end refIdentShort

  // if projectName is not known
  def refIdentShort(refIdent: String, companyId: String): String =
    val projectNames = projectConfigs.map(pc => pc.name)

    projectNames.find(refIdent.startsWith)
      .map(pn =>
        refIdent.replace(s"$pn-", "") // case myCompany-myProject-myProcess
          .replace(s"$companyId-", "") // case myCompany-myProject > where no myProcess
      )
      .orElse(     // case myProject-myProcess
        projectNames.map(_.replace(s"$companyId-", ""))
          .find(refIdent.startsWith)
          .map(pn =>
            refIdent.replace(s"$pn-", "")
          )
      ).getOrElse( // or any other process
        refIdent
      )
  end refIdentShort

  def projectNameForRef(processRef: String): String =
    projectConfigs
      .find(pc => processRef.startsWith(pc.name))
      .map(_.name)
      .getOrElse("NO PROJECT FOUND")
  end projectNameForRef

end ProjectsConfig

case class ProjectsPerGitRepoConfig(
    // Base URL for the Git Repos
    // The pattern must be $cloneBaseUrl/$projectName.git
    cloneBaseUrl: String,
    // Definition of the projects
    projects: Seq[ProjectConfig],
    // if all projects are in one repo (one repo for whole company)
    singleRepo: Boolean = false
):

  def init(gitDir: os.Path, companyName: String) =
    if singleRepo then
      ZIO
        .attemptBlocking(updateClone(gitDir, companyName)) // git - not on the compute pool
        .flatMap: _ =>
          ZIO.foreachPar(projects): project =>
            ZIO.attemptBlocking: // copying - not on the compute pool
              val gitTemp    = gitDir / s"orchescala-$companyName" / "projects" / project.name
              val projectGit = project.absGitPath(gitDir)
              println(s"Copy init $gitTemp to $projectGit")
              if os.exists(projectGit) then
                os.remove.all(projectGit)
              os.copy(gitTemp, projectGit)
            .withParallelism(DefaultEngineConfig().parallelism)
    else
      ZIO.foreachPar(projects): project =>
        ZIO.attempt:
          val gitRepo = s"$cloneBaseUrl/${project.name}.git"
          updateProject(project.absGitPath(gitDir), gitRepo)
        .withParallelism(DefaultEngineConfig().parallelism)

  /** Makes a project's checkout in git-temp - blocks (git clone/pull, copy): call it from a blocking
    * thread (`ZIO.attemptBlocking`), as DocCreator does.
    */
  def initProject(gitDir: os.Path, projectName: String, companyName: String): Unit =
    // ProjectsConfig asks every repo config - only the one with the project acts
    if singleRepo && containsProject(projectName) then
      // the same clone as init - updated once per run, also when the projects of the company come here in
      // parallel (DocCreator); then the project is copied from it. (It ran nothing before: the ZIO it
      // built was dropped.)
      val clone      = updateClone(gitDir, companyName)
      val gitTemp    = clone / "projects" / projectName
      if !os.isDir(gitTemp) then
        throw new Exception(s"$projectName is not in the company repo $clone (no projects/$projectName)")
      val projectGit = gitDir / projectName
      println(s"Copy initProject $gitTemp to $projectGit")
      if os.exists(projectGit) then
        os.remove.all(projectGit)
      os.copy(gitTemp, projectGit)
    else if !singleRepo then
      projects.find(_.name == projectName)
        .foreach: project =>
          val gitRepo = s"$cloneBaseUrl/${project.name}.git"
          updateProject(project.absGitPath(gitDir), gitRepo)
  end initProject

  /** The company clone `orchescala-<company>` (one repo for all), made or pulled - once per run, also with
    * callers in parallel (init, initProject, the docs).
    * @param keepOnFailure the docs: offline or with origin away, a clone with a commit serves as it is (a
    *   warning) - init and initProject fail, as before
    * @return the clone
    */
  def updateClone(gitDir: os.Path, companyName: String, keepOnFailure: Boolean = false): os.Path =
    val clone = gitDir / s"orchescala-$companyName"
    // a clone killed midway has a .git, but no commit - it does not serve
    def usable = Try(os.proc("git", "-C", clone.toString, "rev-parse", "--verify", "-q", "HEAD")
      .call(check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode == 0).getOrElse(false)
    // gone meanwhile (git-temp wiped in a process that runs on): made again, whatever the last update was
    Try(ProjectsPerGitRepoConfig.once(clone, force = !os.exists(clone / ".git"))(updateProject(clone, s"$cloneBaseUrl/orchescala-$companyName.git"))) match
      case Success(_)                                => clone
      case Failure(e) if keepOnFailure && usable     =>
        println(s"  ! $clone not updated (${e.getMessage}) - the clone as it is")
        clone
      case Failure(e)                                => throw e

  def containsProject(projectName: String): Boolean =
    projects.exists(_.name == projectName)

  private def updateProject(gitProjectDir: os.Path, gitRepo: String): Unit =
    println(s"Git Project Dir: $gitProjectDir")
    println(s"Git Repo: $gitRepo")
    os.makeDir.all(gitProjectDir)
    if !(gitProjectDir / ".gitignore").toIO.exists() then
      os.proc("git", "clone", gitRepo, gitProjectDir)
        .callOnConsole(gitProjectDir)
    else
      os
        .proc("git", "checkout", "develop")
        .callOnConsole(gitProjectDir)
      os.proc("git", "pull", "origin", "develop")
        .callOnConsole(gitProjectDir)
    end if
  end updateProject
end ProjectsPerGitRepoConfig

object ProjectsPerGitRepoConfig:
  // a ReentrantLock, not synchronized: a clone or pull would pin a virtual thread's carrier
  private final class Update:
    val lock                             = ReentrantLock()
    var doneAt: Long                     = Long.MinValue
    var failed: Option[(Long, Throwable)] = None
  private[api] val UpdateValidMs       = 5 * 60 * 1000L
  private[api] val FailedUpdateValidMs = 30 * 1000L
  private val updates = ConcurrentHashMap[os.Path, Update]()

  /** `update` of a clone once per run - a caller at the same time waits for it, then goes on. A successful
    * update counts `UpdateValidMs` (as the tag fetch of the docs: a process that runs on pulls again for
    * its next docs run), a failed one `FailedUpdateValidMs` - its callers get that failure again.
    * @param force read under the lock - e.g. «the clone is gone»: then it updates whatever the last time
    */
  private[api] def once(clone: os.Path, now: => Long = System.currentTimeMillis(), force: => Boolean = false)(
      update: => Unit
  ): Unit =
    val state = updates.computeIfAbsent(clone, _ => Update())
    state.lock.lock()
    try
      val start  = now // read once
      val forced = force // under the lock: a caller that waited sees what the one before did
      state.failed match
        // failed just now: the same failure, not another pull per project - a new one per caller (one
        // instance on many threads would collect their suppressed errors). Only git's failures pass here,
        // no typed errors of the docs (ReleaseNotFound comes after the clone)
        case Some((at, e)) if !forced && start - at < FailedUpdateValidMs => throw new Exception(e.getMessage, e)
        case _ if !forced && state.doneAt != Long.MinValue && start - state.doneAt < UpdateValidMs => ()
        case _ =>
          try
            update
            state.doneAt = start
            state.failed = None
          catch
            case NonFatal(e) =>
              state.failed = Some(start -> e)
              throw e
    finally state.lock.unlock()
end ProjectsPerGitRepoConfig

case class ProjectConfig(
    // Name of the project
    name: String,
    // you can group your projects - for better overview
    group: ProjectGroup,
    // the color of your project - for better overview and visualization in the BPMN diagrams
    color: String = "#fff",
    // processType to create new BPMN diagrams - default is Camunda 7
    bpmnProcessType: BpmnProcessType = BpmnProcessType.C7()
):
  def absGitPath(gitDir: os.Path): os.Path  = gitDir / name
  def absBpmnPath(gitDir: os.Path): os.Path = absGitPath(gitDir) / bpmnProcessType.diagramPath
end ProjectConfig

case class ProjectGroup(
    name: String,
    // line color
    color: String = "purple",
    fill: String = "#ddd"
)
enum SupportedEngine:
  case C7, C8, Op
object SupportedEngine:
  given InOutCodec[SupportedEngine] = deriveEnumInOutCodec
  given ApiSchema[SupportedEngine]  = deriveApiSchema

case class ModelerTemplateConfig(
    supportedEngine: SupportedEngine = SupportedEngine.C7,
    templateRelativePath: os.RelPath = os.rel / ".camunda" / "element-templates",
    generateGeneralVariables: Boolean = true
):
  lazy val templatePath: os.Path = os.pwd / templateRelativePath

  lazy val schemaC7 =
    s"https://unpkg.com/@camunda/element-templates-json-schema@0.16.0/resources/schema.json"
  lazy val schemaC8 =
    "https://unpkg.com/@camunda/zeebe-element-templates-json-schema/resources/schema.json"
end ModelerTemplateConfig
