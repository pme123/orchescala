package orchescala.helper.openApi

import scala.jdk.CollectionConverters.*

case class WorkerGenerator()(using val config: OpenApiConfig, val apiDefinition: ApiDefinition)
    extends GeneratorHelper:

  lazy val generate: Unit =
    os.remove.all(workerPath)
    os.makeDir.all(workerPath)
    generateExports
    generateWorkers
    generateWorkerTests
  end generate

  protected lazy val workerPath: os.Path = config.workerPath(superClass.versionPackage)
  protected lazy val workerPackageSplitted: (String, String) = config.workerPackageSplitted(superClass.versionPackage)

  private lazy val generateExports =
    val content =
      s"""package ${workerPackageSplitted._1}
         |package ${workerPackageSplitted._2}
         |
         |def serviceBasePath: String =
         |  s"TODO: my Base Path, like https://mycomp.com/myservice"
         |""".stripMargin
    os.write.over(workerPath / s"exports.scala", content)
  end generateExports

  private lazy val generateWorkers =
    apiDefinition.bpmnClasses
      .map:
        generateWorker
      .map:
        case name -> content =>
          os.write.over(workerPath / s"${name}Worker.scala", content)

  private lazy val generateWorkerTests =
    apiDefinition.bpmnClasses
      .map:
        generateWorkerTest
      .map:
        case name -> content =>
          os.write.over(workerPath / s"${name}WorkerTest.scala", content)

  private def generateWorker(bpmnServiceObject: BpmnServiceObject) =
    val name = bpmnServiceObject.className
    val superClass = apiDefinition.superClass

    name ->
      s"""package ${workerPackageSplitted._1}
         |package ${workerPackageSplitted._2}
         |
         |import WorkerError.*
         |
         |import ${bpmnPackageSplitted._1}.*
         |import $bpmnPackage.*
         |import $bpmnPackage.schema.*
         |import $bpmnPackage.$name.*
         |
         |class ${name}Worker
         |  extends ${config.superWorkerClass}[In, Out, ServiceIn, ServiceOut]:
         |
         |  lazy val serviceTask = example
         |
         |  override lazy val method = Method.${bpmnServiceObject.method}
         |
         |  def apiUri(in: In) =
         |    uri"$$serviceBasePath${bpmnServiceObject.path.replace("{", "${in.")}"
         |
         |  override def validate(in: In): Either[ValidatorError, In] =
         |    ??? // additional validation
         |
         |  override def inputHeaders(in: In) =
         |    ??? // etagInHeader(in.etag)
         |        // requestIdInHeader(in.requestId)
         |
         |  override def querySegments(in: In) =
         |    ??? //TODO queryKeys("someParams")
         |
         |${
          if bpmnServiceObject.in.nonEmpty then
            """  override def inputMapper(
              |      in: In
              |  ) =
              |    ???
              |  end inputMapper
              |""".stripMargin
          else ""
        }
         |${
          if bpmnServiceObject.out.nonEmpty then
            """  override def outputMapper(
              |      out: ServiceResponse[ServiceOut],
              |      in: In
              |  ) =
              |    ???
              |  end outputMapper
              |""".stripMargin
          else ""
        }
         |end ${name}Worker
         |
         |""".stripMargin
  end generateWorker

  private def generateWorkerTest(bpmnServiceObject: BpmnServiceObject) =
    val name = bpmnServiceObject.className
    val superClass = apiDefinition.superClass

    name ->
      s"""package ${workerPackageSplitted._1}
         |package ${workerPackageSplitted._2}
         |
         |import WorkerError.*
         |
         |import ${bpmnPackageSplitted._1}.*
         |import $bpmnPackage.*
         |import $bpmnPackage.schema.*
         |import $bpmnPackage.$name.*
         |
         |//sbt worker/testOnly *${name}WorkerTest
         |class ${name}WorkerTest
         |  extends munit.FunSuite:
         |
         |  lazy val worker = ${name}Worker()
         |
         |  test("method"):
         |    assertEquals(worker.method, Method.???)
         |
         |  test("apiUri"):
         |    assertEquals(
         |      worker.apiUri(In.example).toString,
         |      s"NOT-SET/YourPath"
         |    )
         |
         |  test("inputMapper"):
         |    assertEquals(
         |      worker.inputMapper(In.example),
         |      Some(ServiceIn.example)
         |    )
         |  test("inputMapper minimal"):
         |    assertEquals(
         |      worker.inputMapper(In.exampleMinimal),
         |      Some(ServiceIn.exampleMinimal)
         |    )
         |
         |  test("outputMapper"):
         |    assertEquals(
         |      worker.outputMapper(
         |        ServiceOut.mock.toServiceResponse,
         |        In.example
         |      ),
         |      Right(Out.example)
         |    )
         |  test("outputMapper minimal"):
         |    assertEquals(
         |      worker.outputMapper(
         |        ServiceOut.mockMinimal.toServiceResponse,
         |        In.exampleMinimal
         |      ),
         |      Right(Out.exampleMinimal)
         |    )
         |
         |end ${name}WorkerTest
         |""".stripMargin
  end generateWorkerTest
end WorkerGenerator
