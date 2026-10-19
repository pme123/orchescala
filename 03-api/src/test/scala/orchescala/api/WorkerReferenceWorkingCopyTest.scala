package orchescala
package api

import orchescala.engine.DefaultEngineConfig

class WorkerReferenceWorkingCopyTest extends munit.FunSuite:

  private val ownTopic = "test-own-bookV1-Notify"

  private def domain(pkg: String, obj: String, topic: String) =
    s"""package $pkg
       |
       |object $obj:
       |  final val topicName = "$topic"
       |end $obj
       |""".stripMargin

  // the own worker, composed of a worker of test-services
  private def ownWorker(usedImport: String, param: String) =
    s"""package test.own.worker.bookAppointment.v1
       |
       |import test.own.domain.bookAppointment.v1.Notify.*
       |import $usedImport
       |
       |class NotifyWorker(
       |    $param
       |) extends CompanyCustomWorkerDsl[In, Out]:
       |
       |  lazy val customTask = example
       |
       |end NotifyWorker
       |""".stripMargin

  private def serviceWorker(pkg: String, cls: String, domainImport: String) =
    s"""package $pkg
       |
       |import $domainImport
       |
       |class $cls extends CompanyCustomWorkerDsl[In, Out]:
       |
       |  lazy val customTask = example
       |
       |end $cls
       |""".stripMargin

  // git-temp: the pushed state - composed of the old SendEmailWorker; the working copy: of SendMailWorker
  private val gitDir    = os.temp.dir()
  private val ownDir    = os.temp.dir()
  private val bareDir   = os.temp.dir()
  // a working copy with its workers only - the domain (the topics) comes from the clone
  private val workerDir = os.temp.dir()

  // deleteOnExit does not delete a directory with files in it
  override def afterAll(): Unit = Seq(gitDir, ownDir, bareDir, workerDir).foreach(os.remove.all)

  private lazy val written =
    def write(path: os.Path, content: String) = os.write.over(path, content, createFolders = true)
    val services = gitDir / "test-services"
    write(services / "01-domain" / "src" / "main" / "scala" / "Mails.scala",
      domain("test.services.domain.mails.v1", "SendEmail", "test-services-mailsV1-SendEmail") +
        "\n" + domain("test.services.domain.mails.v1", "SendMail", "test-services-smtpV1-SendMail"))
    write(services / "03-worker" / "src" / "main" / "scala" / "SendEmailWorker.scala",
      serviceWorker("test.services.worker.mails.v1", "SendEmailWorker", "test.services.domain.mails.v1.SendEmail.*"))
    write(services / "03-worker" / "src" / "main" / "scala" / "SendMailWorker.scala",
      serviceWorker("test.services.worker.smtp.v1", "SendMailWorker", "test.services.domain.mails.v1.SendMail.*"))
    for dir <- Seq(gitDir / "test-own", ownDir) do
      write(dir / "01-domain" / "src" / "main" / "scala" / "Notify.scala",
        domain("test.own.domain.bookAppointment.v1", "Notify", ownTopic))
    write(gitDir / "test-own" / "03-worker" / "src" / "main" / "scala" / "NotifyWorker.scala",
      ownWorker("test.services.worker.mails.v1.SendEmailWorker", "sendEmailWorker: SendEmailWorker"))
    for dir <- Seq(ownDir, workerDir) do
      write(dir / "03-worker" / "src" / "main" / "scala" / "NotifyWorker.scala",
        ownWorker("test.services.worker.smtp.v1.SendMailWorker", "sendMailWorker: SendMailWorker"))

  private class OwnProject(basePath: os.Path) extends ProcessReferenceCreator:
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
    def usesWorkersOf(topic: String): Seq[WorkerRef]   = usesWorkers(topic)
    def usedByWorkersOf(topic: String): Seq[WorkerRef] = usedByWorkers(topic)
  end OwnProject

  test("the own worker is composed of what its working copy says - not its pushed clone in git-temp"):
    written
    val own = OwnProject(ownDir)
    assertEquals(own.usesWorkersOf(ownTopic).map(_.className), Seq("SendMailWorker"))
    assertEquals(own.usedByWorkersOf("test-services-smtpV1-SendMail").map(_.className), Seq("NotifyWorker"))
    assertEquals(own.usedByWorkersOf("test-services-mailsV1-SendEmail"), Seq.empty)

  private lazy val ownConfig = TestProjects.config("test-own").projectConfigs.head

  test("without sources in its working copy the own project is read from its clone in git-temp"):
    written
    val own = OwnProject(bareDir)
    assertEquals(own.sourceDir(ownConfig, "03-worker"), gitDir / "test-own")
    assertEquals(own.usesWorkersOf(ownTopic).map(_.className), Seq("SendEmailWorker"))

  test("per module: only the workers in the working copy - the domain (the topics) from the clone"):
    written
    val own = OwnProject(workerDir)
    assertEquals(own.sourceDir(ownConfig, "03-worker"), workerDir)
    assertEquals(own.sourceDir(ownConfig, "01-domain"), gitDir / "test-own")
    // the topic of the own worker is still known - and it is composed of the working copy's worker
    assertEquals(own.usesWorkersOf(ownTopic).map(_.className), Seq("SendMailWorker"))

  test("another project is read from its clone in git-temp"):
    written
    val services = TestProjects.config("test-services").projectConfigs.head
    assertEquals(OwnProject(ownDir).sourceDir(services, "03-worker"), gitDir / "test-services")

end WorkerReferenceWorkingCopyTest
