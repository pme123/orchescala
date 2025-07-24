package orchescala.helper.dev.update

import orchescala.api.DependencyConfig

case class WorkerGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    createOrUpdate(workerPath() / "WorkerApp.scala", workerApp)
    createOrUpdate(workerTestPath() / "WorkerTestApp.scala", workerTestApp)
    createOrUpdate(workerConfigPath / "logback.xml", logbackXml)
  end generate

  def createProcessWorker(setupElement: SetupElement): Unit =
    createWorker(setupElement, processWorker, processWorkerTest)

  def createEventWorker(setupElement: SetupElement): Unit =
    createWorker(setupElement, eventWorker, eventWorkerTest)

  def createWorker(
      setupElement: SetupElement,
      worker: SetupElement => String = processElement,
      workerTest: SetupElement => String = processElementTest
  ): Unit =
    createIfNotExists(
      workerPath(Some(setupElement)),
      worker(setupElement)
    )
    createIfNotExists(
      workerTestPath(Some(setupElement)),
      workerTest(setupElement)
    )
  end createWorker

  private lazy val companyName = config.companyName
  private lazy val workerApp   =
    createWorkerApp("WorkerApp")

  private lazy val workerTestApp =
    createWorkerApp("WorkerTestApp", Some(config.apiProjectConfig.dependencies))

  private def createWorkerApp(
      objName: String,
      dependencies: Option[Seq[DependencyConfig]] = None
  ) =
    s"""$helperDoNotAdjustText
       |package ${config.projectPackage}.worker
       |
       |// sbt worker/${dependencies.map(_ => "test:").getOrElse("")}run
       |object $objName extends CompanyWorkerApp:
       |  workers(
       |    ${dependencies.map(_ => "").getOrElse("//TODO add workers here")}
       |  )
       |  dependencies(
       |    ${
        dependencies
          .map:
            _.map(_.projectPackage + ".worker.WorkerApp")
              .mkString("WorkerApp,\n    ",",\n    ", "")
          .getOrElse("")
      }
       |  )
       |end $objName""".stripMargin

  private def processWorker(setupElement: SetupElement) =
    val SetupElement(_, processName, workerName, version) = setupElement
    s"""package ${config.projectPackage}
       |package worker.$processName${version.versionPackage}
       |
       |import ${config.projectPackage}.domain.$processName${version.versionPackage}.$workerName.*
       |
       |class ${workerName}Worker extends CompanyInitWorkerDsl[In, Out, InitIn, InConfig]:
       |
       |  lazy val inOutExample = example
       |
       |  override def customInit(in: In): InitIn =
       |    InitIn() //TODO add variable initialisation (to simplify the process expressions) or remove function
       |    // NoInput() // if no initialization is needed
       |  
       |end ${workerName}Worker""".stripMargin
  end processWorker

  private def eventWorker(setupElement: SetupElement) =
    val SetupElement(_, processName, workerName, version) = setupElement
    s"""package ${config.projectPackage}
       |package worker.$processName${version.versionPackage}
       |
       |import ${config.projectPackage}.domain.$processName${version.versionPackage}.$workerName.*
       |
       |class ${workerName}Worker extends CompanyValidationWorkerDsl[In]:
       |
       |  lazy val inOutExample = example
       |  
       |  // remove it if not needed
       |  override def validate(in: In): Either[WorkerError.ValidatorError, In] = super.validate(in)
       |
       |end ${workerName}Worker""".stripMargin
  end eventWorker

  private def processElement(
      setupElement: SetupElement
  ) =
    val SetupElement(label, processName, workerName, version) = setupElement
    s"""package ${config.projectPackage}
       |package worker.$processName${version.versionPackage}
       |
       |import ${config.projectPackage}.domain.$processName${version.versionPackage}.$workerName.*
       |
       |class ${workerName}Worker extends Company${label.replace("Task", "")}WorkerDsl[In, Out${
        if label == "CustomTask" then "" else ", ServiceIn, ServiceOut"
      }]:
       |
       |${workerContent(label)}
       |
       |end ${workerName}Worker""".stripMargin
  end processElement

  private def workerContent(label: String) =
    if label == "CustomTask"
    then
      """  lazy val customTask = example
        |
        |  override def runWork(in: In): Either[WorkerError.CustomError, Out] =
        |    ???
        |  end runWork""".stripMargin
    else
      """
        |  lazy val serviceTask = example
        |
        |  override lazy val method = Method.GET
        |
        |  def apiUri(in: In) = uri"your/path/TODO"
        |
        |  override def querySegments(in: In) = ???
        |    // queryKeys(ks: String*)
        |    // queryKeyValues(kvs: (String, Any)*)
        |    // queryValues(vs: Any*)
        |
        |  override def inputHeaders(in: In) = ???
        |
        |  override def inputMapper(in: In): Option[ServiceIn] = ???
        |
        |  override def outputMapper(
        |      out: ServiceResponse[ServiceOut],
        |      in: In
        |  ) = ???
        |
        |""".stripMargin
  private def processWorkerTest(setupElement: SetupElement) =
    workerTest(setupElement):
      s"""
         |  test("customInit"):
         |    val in = inExample
         |    val out = InitIn()
         |    assertEquals(
         |      worker.customInit(in),
         |      out
         |    )
         |  test("customInit minimal"):
         |    val in = inExampleMinimal
         |    val out = InitIn()
         |    assertEquals(
         |      worker.customInit(in),
         |      out
         |  )
         |""".stripMargin

  private def eventWorkerTest(setupElement: SetupElement) =
    workerTest(setupElement):
      s"""
         |  test("validate"):
         |    val in = inExample
         |    assertEquals(
         |      worker.validate(in), 
         |      Right(in)
         |    )
         |  test("validate minimal"):
         |    val in = inExampleMinimal
         |    assertEquals(
         |      worker.validate(in),
         |      Right(in)
         |    )
         |""".stripMargin

  private def processElementTest(setupElement: SetupElement) =
    workerTest(setupElement):
      if setupElement.label == "CustomTask"
      then
        s"""
           |  test("runWork"):
           |    val in = inExample
           |    val out = Right(outExample)
           |    assertEquals(
           |      worker.runWork(in),
           |      out
           |    )
           |  test("runWork minimal"):
           |    val in = inExampleMinimal
           |    val out = Right(outExampleMinimal)
           |    assertEquals(
           |      worker.runWork(in),
           |      out
           |    )
           |""".stripMargin
      else
        s"""
           |  test("apiUri"):
           |    assertEquals(
           |      worker.apiUri(inExample).toString,
           |      s"NOT-SET/YourPath"
           |    )
           |
           |  test("inputMapper"):
           |    assertEquals(
           |      worker.inputMapper(inExample),
           |      Some(serviceInExample)
           |    )
           |
           |  test("inputMapper minimal"):
           |    assertEquals(
           |      worker.inputMapper(inExampleMinimal),
           |      Some(serviceInMinimalExample)
           |    )
           |
           |  test("outputMapper"):
           |    assertEquals(
           |      worker.outputMapper(
           |        serviceMock.toServiceResponse,
           |        inExample
           |      ),
           |      Right(outExample)
           |    )
           |  test("outputMapper minimal"):
           |    assertEquals(
           |      worker.outputMapper(
           |        serviceMinimalMock.toServiceResponse,
           |        inExampleMinimal
           |      ),
           |      Right(outExampleMinimal)
           |    )
           |
           |""".stripMargin
  end processElementTest

  private def workerTest(setupElement: SetupElement)(tests: String) =
    val SetupElement(_, processName, workerName, version) = setupElement
    s"""package ${config.projectPackage}
       |package worker.$processName${version.versionPackage}
       |
       |import ${config.projectPackage}.domain.$processName${version.versionPackage}.$workerName.*
       |import ${config.projectPackage}.worker.$processName${version.versionPackage}.${workerName}Worker
       |
       |//sbt worker/testOnly *${workerName}WorkerTest
       |class ${workerName}WorkerTest extends munit.FunSuite:
       |
       |  lazy val worker = ${workerName}Worker()
       |
       |$tests
       |
       |
       |end ${workerName}WorkerTest""".stripMargin
  end workerTest

  lazy val logbackXml =
    s"""<!-- DO NOT ADJUST. This file is replaced by `./helper.scala update` -->
       |<configuration>
       |    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
       |        <encoder>
       |            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
       |        </encoder>
       |    </appender>
       |
       |    <logger name="orchescala" level="INFO"/>
       |    <logger name="${config.companyName}" level="INFO"/>
       |    <logger name="org.camunda.bpm.client" level="INFO"/>
       |    <logger name="org.glassfish.jaxb" level="WARN"/>
       |    <logger name="com.sun.xml.bind" level="WARN"/>
       |
       |    <root level="WARN">
       |        <appender-ref ref="STDOUT" />
       |    </root>
       |</configuration>
       |""".stripMargin

  private def workerPath(setupElement: Option[SetupElement] = None) =
    val dir = config.projectDir / ModuleConfig.workerModule.packagePath(
      config.projectPath
    ) /
      setupElement
        .map: se =>
          os.rel / se.processName / se.version.versionPath
        .getOrElse(os.rel)

    os.makeDir.all(dir)
    dir / setupElement
      .map: se =>
        os.rel / s"${se.bpmnName}Worker.scala"
      .getOrElse(os.rel)
  end workerPath

  private def workerTestPath(setupElement: Option[SetupElement] = None) =
    val dir = config.projectDir / ModuleConfig.workerModule.packagePath(
      config.projectPath,
      mainOrTest = "test"
    ) /
      setupElement
        .map: se =>
          os.rel / se.processName / se.version.versionPath
        .getOrElse(os.rel)
    os.makeDir.all(dir)
    dir / setupElement
      .map: se =>
        os.rel / s"${se.bpmnName}WorkerTest.scala"
      .getOrElse(os.rel)
  end workerTestPath

  private lazy val workerConfigPath =
    val dir = config.projectDir / ModuleConfig.workerModule.packagePath(
      config.projectPath,
      isSourceDir = false
    )
    os.makeDir.all(dir)
    dir
  end workerConfigPath
end WorkerGenerator
