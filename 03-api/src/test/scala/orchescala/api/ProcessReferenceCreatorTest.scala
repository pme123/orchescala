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
  private lazy val gitDir  = os.temp.dir()
  private lazy val ownDir  = os.temp.dir()
  private lazy val written =
    os.write(gitDir / "test-own" / "src" / "main" / "resources" / "camunda" / "book.bpmn",
      bpmn("test-own-bookV1-SendMail"), createFolders = true)
    os.write(ownDir / "src" / "main" / "resources" / "camunda" / "book.bpmn",
      bpmn("test-services-smtpV1-SendMail"), createFolders = true)

  private object OwnProjectReferenceCreator extends ProcessReferenceCreator:
    override protected def projectName: String = "test-own"
    lazy val apiConfig: ApiConfig =
      ApiConfig(
        DefaultEngineConfig(),
        basePath = ownDir,
        companyName = "test",
        projectsConfig = TestProjects.config("test-own", "test-services"),
        docBaseUrl = Some("https://docs.test.com"),
        tempGitDir = gitDir,
        scanTempGitDirForUsages = false
      )
  end OwnProjectReferenceCreator

  test("the own process uses what its working copy says - not its pushed clone in git-temp"):
    written
    val doc = OwnProjectReferenceCreator.UsesReferenceCreator("test-own-bookV1").create()
    assert(doc.contains("/site/test/test-services/OpenApi.html"), doc)
    assert(!doc.contains("/site/test/test-own/OpenApi.html"), doc)

  test("another project is read from its clone in git-temp"):
    written
    val services = TestProjects.config("test-services").projectConfigs.head
    assertEquals(OwnProjectReferenceCreator.bpmnDir(services), services.absBpmnPath(gitDir))

end ProcessReferenceCreatorTest
