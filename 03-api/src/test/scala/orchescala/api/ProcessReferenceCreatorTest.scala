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

end ProcessReferenceCreatorTest
