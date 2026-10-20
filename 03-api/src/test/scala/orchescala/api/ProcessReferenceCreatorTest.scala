package orchescala
package api

import orchescala.engine.DefaultEngineConfig

class ProcessReferenceCreatorTest extends munit.FunSuite:

  private def bpmn(topic: String) =
    s"""<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d">
       |  <bpmn:process id="test-own-bookV1">
       |    <bpmn:serviceTask id="SendMailTask" camunda:type="external" camunda:topic="$topic" />
       |  </bpmn:process>
       |</bpmn:definitions>""".stripMargin

  // git-temp: the pushed state with the old topic; the working copy: the new one
  private val gitDir  = os.temp.dir()
  private val ownDir  = os.temp.dir()
  // a working copy without a BPMN of its own (no camunda/) - its clone is used
  private val bareDir = os.temp.dir()

  // deleteOnExit does not delete a directory with files in it
  override def afterAll(): Unit =
    Seq(gitDir, ownDir, bareDir).foreach(os.remove.all)
    super.afterAll()
  private lazy val written =
    os.write(gitDir / "test-own" / "src" / "main" / "resources" / "camunda" / "book.bpmn",
      bpmn("test-own-bookV1-SendMail"), createFolders = true)
    os.write(ownDir / "src" / "main" / "resources" / "camunda" / "book.bpmn",
      bpmn("test-services-smtpV1-SendMail"), createFolders = true)
    // a worker and its domain object - so the domain identifiers are read too
    os.write(ownDir / "01-domain" / "src" / "main" / "scala" / "Book.scala",
      """package test.own.domain
        |
        |object Book:
        |  final val topicName = "test-own-bookV1"
        |end Book
        |""".stripMargin, createFolders = true)
    os.write(ownDir / "03-worker" / "src" / "main" / "scala" / "BookWorker.scala",
      """package test.own.worker
        |
        |import test.own.domain.Book.*
        |
        |class BookWorker extends CompanyCustomWorkerDsl[In, Out]:
        |  lazy val customTask = example
        |end BookWorker
        |""".stripMargin, createFolders = true)

  private class OwnProjectReferenceCreator(basePath: os.Path) extends ProcessReferenceCreator:
    override protected def projectName: String = "test-own"
    lazy val apiConfig: ApiConfig =
      ApiConfig(
        DefaultEngineConfig(),
        basePath = basePath,
        companyName = "test",
        projectsConfig = TestProjects.config("test-own", "test-services"),
        docBaseUrl = Some("https://docs.test.com"),
        tempGitDir = gitDir,
        scanTempGitDirForUsages = false
      )
    def key: String = ownCacheKey
    // reads the BPMNs, the worker sources and the domain identifiers
    def readAll(): Unit =
      allBpmns
      usesWorkers("test-own-bookV1")
  end OwnProjectReferenceCreator

  private lazy val withWorkingCopy = OwnProjectReferenceCreator(ownDir)
  private lazy val withoutBpmn     = OwnProjectReferenceCreator(bareDir)

  test("the own process uses what its working copy says - not its pushed clone in git-temp"):
    written
    val doc = withWorkingCopy.UsesReferenceCreator("test-own-bookV1").create()
    assert(doc.contains("/site/test/test-services/OpenApi.html"), doc)
    assert(!doc.contains("/site/test/test-own/OpenApi.html"), doc)

  test("without a BPMN in its working copy the own project is read from its clone in git-temp"):
    written
    val own = TestProjects.config("test-own").projectConfigs.head
    assertEquals(withoutBpmn.bpmnDir(own), own.absBpmnPath(gitDir))
    val doc = withoutBpmn.UsesReferenceCreator("test-own-bookV1").create()
    assert(doc.contains("/site/test/test-own/OpenApi.html"), doc)

  test("another project is read from its clone in git-temp"):
    written
    val services = TestProjects.config("test-services").projectConfigs.head
    assertEquals(withWorkingCopy.bpmnDir(services), services.absBpmnPath(gitDir))

  test("the BPMNs, the worker sources and the domain identifiers are cached under the one key"):
    written
    withWorkingCopy.readAll()
    val key = withWorkingCopy.key
    assert(ProcessReferenceCreator.bpmnCacheKeys.contains(key), ProcessReferenceCreator.bpmnCacheKeys.toString)
    assert(WorkerReferenceCreator.sourceCacheKeys.contains(key), WorkerReferenceCreator.sourceCacheKeys.toString)
    assert(WorkerReferenceCreator.domainCacheKeys.contains(key), WorkerReferenceCreator.domainCacheKeys.toString)

  test("the key carries the own project and its working copy - another working copy, another key"):
    assert(withWorkingCopy.key.endsWith(s"own: test-own @ $ownDir"), withWorkingCopy.key)
    // the same project and git-temp, only the working copy differs
    assertNotEquals(OwnProjectReferenceCreator(ownDir).key, OwnProjectReferenceCreator(bareDir).key)

end ProcessReferenceCreatorTest
