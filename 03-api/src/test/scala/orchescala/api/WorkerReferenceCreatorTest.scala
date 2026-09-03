package orchescala
package api

import orchescala.engine.DefaultEngineConfig

class WorkerReferenceCreatorTest extends munit.FunSuite:

  private val postSignalTopic = "test-services-camundaV7.PostSignal"
  private val cancelTopic     = "test-cms-general.cancel.CancelCreateAndSignDocument"

  test("a Worker knows the Workers it is composed of"):
    val workers = TestWorkerReferenceCreator.usesWorkersOf(cancelTopic)
    assertEquals(
      workers.map(w => w.className -> w.topicName),
      Seq(
        "GetClientWorker"          -> None,
        "GetProcessInstanceWorker" -> Some("test-services-camundaV7.GetProcessInstance"),
        "PostSignalWorker"         -> Some(postSignalTopic)
      )
    )

  test("a Worker knows the Workers it is used by"):
    val workers = TestWorkerReferenceCreator.usedByWorkersOf(postSignalTopic)
    assertEquals(workers.map(_.className), Seq("CancelCreateAndSignDocumentWorker"))

  test("a Worker of an unknown Project has no link"):
    val worker = TestWorkerReferenceCreator.usesWorkersOf(cancelTopic)
      .find(_.className == "GetClientWorker")
      .get
    assertEquals(worker.projectName, "other-company")
    assertEquals(worker.asString, "_Worker: GetClientWorker_")

  test("the used Workers are documented with a link to their Project"):
    val doc = TestWorkerReferenceCreator.UsesReferenceCreator(cancelTopic).create()
    assert(doc.contains("<b>Uses 2 Project(s)</b>"), doc)
    assert(
      doc.contains(
        "_[Worker: PostSignal](https://docs.test.com/site/test/test-services/OpenApi.html#operation/Worker:%20PostSignal)_"
      ),
      doc
    )

  test("the using Workers are documented with a link to their Project"):
    val doc = TestWorkerReferenceCreator.UsedByReferenceCreator(postSignalTopic).create()
    assert(doc.contains("<b>Used in 1 Project(s)</b>"), doc)
    assert(
      doc.contains(
        "_[Worker: general.cancel.CancelCreateAndSignDocument](https://docs.test.com/site/test/test-cms/OpenApi.html#operation/Worker:%20general.cancel.CancelCreateAndSignDocument)_"
      ),
      doc
    )

  test("a Worker that is not composed has no Worker references"):
    val topic = "test-services-camundaV7.GetProcessInstance"
    assertEquals(TestWorkerReferenceCreator.usesWorkersOf(topic), Seq.empty)
    assertEquals(TestWorkerReferenceCreator.usedByWorkersOf(topic).map(_.className),
      Seq("CancelCreateAndSignDocumentWorker"))

  test("the Scala sources are only read once - also for other ApiCreators of the run"):
    TestWorkerReferenceCreator.usesWorkersOf(cancelTopic) // reads the sources
    val out = java.io.ByteArrayOutputStream()
    val workers = Console.withOut(out):
      OtherTestWorkerReferenceCreator.usesWorkersOf(cancelTopic)
    assertEquals(workers.map(_.className), Seq("GetClientWorker", "GetProcessInstanceWorker", "PostSignalWorker"))
    assert(!out.toString.contains("Worker Reference Base Directory"), out.toString)

  // The cross-company case: test-services is the own (and only) project - like swisscom-fil-is -
  // and test-cms, which calls its PostSignal worker, belongs to another company - like valiant.
  test("a reference project's usages are found, although it is not an own project"):
    val workers = ReferenceTestWorkerReferenceCreator.usedByWorkersOf(postSignalTopic)
    assertEquals(workers.map(_.className), Seq("CancelCreateAndSignDocumentWorker"))
    val doc = ReferenceTestWorkerReferenceCreator.UsedByReferenceCreator(postSignalTopic).create()
    assert(doc.contains("<b>Used in 1 Project(s)</b>"), doc)
    assert(doc.contains("/site/test/test-cms/OpenApi.html"), doc)

  test("without the reference project the same usage stays invisible"):
    assertEquals(NoReferenceTestWorkerReferenceCreator.usedByWorkersOf(postSignalTopic), Seq.empty)
    val doc = NoReferenceTestWorkerReferenceCreator.UsedByReferenceCreator(postSignalTopic).create()
    assert(doc.contains("Used in no other Process."), doc)

  test("a project listed as own and as reference is scanned once"):
    assertEquals(
      DuplicateReferenceTestWorkerReferenceCreator.projectNames,
      Seq("test-services", "test-cms")
    )

  // No config knows about test-cms at all - it is found only because its checkout is in git-temp.
  // That is the cross-company case without any mutual config dependency.
  test("a checkout in git-temp is scanned for usages without being configured anywhere"):
    val workers = GitTempTestWorkerReferenceCreator.usedByWorkersOf(postSignalTopic)
    assertEquals(workers.map(_.className), Seq("CancelCreateAndSignDocumentWorker"))
    val doc = GitTempTestWorkerReferenceCreator.UsedByReferenceCreator(postSignalTopic).create()
    assert(doc.contains("<b>Used in 1 Project(s)</b>"), doc)
    assert(doc.contains("/site/test/test-cms/OpenApi.html"), doc)

  test("git-temp discovery appends the unconfigured checkouts after the own projects"):
    assertEquals(GitTempTestWorkerReferenceCreator.projectNames, Seq("test-services", "test-cms"))

end WorkerReferenceCreatorTest

object OtherTestWorkerReferenceCreator extends TestReferenceCreator

/** Own project: test-services only. Reference project: test-cms (the "other company"). */
object ReferenceTestWorkerReferenceCreator extends ProcessReferenceCreator:
  lazy val apiConfig: ApiConfig =
    ApiConfig(
      DefaultEngineConfig(),
      companyName = "test",
      projectsConfig = TestProjects.config("test-services"),
      docBaseUrl = Some("https://docs.test.com"),
      tempGitDir = TestProjects.gitDir
    ).withReferenceProjectsConfigs(TestProjects.config("test-cms"))

  def usedByWorkersOf(topicName: String): Seq[WorkerRef] = usedByWorkers(topicName)
end ReferenceTestWorkerReferenceCreator

/** Own project: test-services only, no reference projects, no git-temp scan - the usage from
  * test-cms is invisible.
  */
object NoReferenceTestWorkerReferenceCreator extends ProcessReferenceCreator:
  lazy val apiConfig: ApiConfig =
    ApiConfig(
      DefaultEngineConfig(),
      companyName = "test",
      projectsConfig = TestProjects.config("test-services"),
      docBaseUrl = Some("https://docs.test.com"),
      tempGitDir = TestProjects.gitDir,
      scanTempGitDirForUsages = false
    )

  def usedByWorkersOf(topicName: String): Seq[WorkerRef] = usedByWorkers(topicName)
end NoReferenceTestWorkerReferenceCreator

/** Own project: test-services only, NO reference config - test-cms is found purely because its
  * checkout sits in tempGitDir (the default scanTempGitDirForUsages = true).
  */
object GitTempTestWorkerReferenceCreator extends ProcessReferenceCreator:
  lazy val apiConfig: ApiConfig =
    ApiConfig(
      DefaultEngineConfig(),
      companyName = "test",
      projectsConfig = TestProjects.config("test-services"),
      docBaseUrl = Some("https://docs.test.com"),
      tempGitDir = TestProjects.gitDir
    )

  def usedByWorkersOf(topicName: String): Seq[WorkerRef] = usedByWorkers(topicName)
  def projectNames: Seq[String]                          = projectConfigs.map(_.name)
end GitTempTestWorkerReferenceCreator

/** test-services is own AND reference - it must not be scanned twice. */
object DuplicateReferenceTestWorkerReferenceCreator extends ProcessReferenceCreator:
  lazy val apiConfig: ApiConfig =
    ApiConfig(
      DefaultEngineConfig(),
      companyName = "test",
      projectsConfig = TestProjects.config("test-services"),
      tempGitDir = TestProjects.gitDir
    ).withReferenceProjectsConfigs(TestProjects.config("test-services", "test-cms"))

  def projectNames: Seq[String] = projectConfigs.map(_.name)
end DuplicateReferenceTestWorkerReferenceCreator

object TestProjects:
  val gitDir: os.Path = os.pwd / "03-api" / "src" / "test" / "resources" / "worker-refs"

  def config(names: String*): ProjectsConfig =
    ProjectsConfig(perGitRepoConfigs =
      Seq(ProjectsPerGitRepoConfig(
        cloneBaseUrl = "https://git.test.com",
        projects = names.map(name => ProjectConfig(name, ProjectGroup("test")))
      ))
    )
end TestProjects
object TestWorkerReferenceCreator      extends TestReferenceCreator

trait TestReferenceCreator extends ProcessReferenceCreator:

  lazy val apiConfig: ApiConfig =
    ApiConfig(
      DefaultEngineConfig(),
      companyName = "test",
      projectsConfig = ProjectsConfig(perGitRepoConfigs =
        Seq(ProjectsPerGitRepoConfig(
          cloneBaseUrl = "https://git.test.com",
          projects = Seq("test-cms", "test-services")
            .map(name => ProjectConfig(name, ProjectGroup("test")))
        ))
      ),
      docBaseUrl = Some("https://docs.test.com"),
      tempGitDir = os.pwd / "03-api" / "src" / "test" / "resources" / "worker-refs"
    )

  def usesWorkersOf(topicName: String): Seq[WorkerRef]   = usesWorkers(topicName)
  def usedByWorkersOf(topicName: String): Seq[WorkerRef] = usedByWorkers(topicName)

end TestReferenceCreator
