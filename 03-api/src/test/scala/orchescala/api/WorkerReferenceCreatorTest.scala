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

end WorkerReferenceCreatorTest

object TestWorkerReferenceCreator extends ProcessReferenceCreator:

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

end TestWorkerReferenceCreator
