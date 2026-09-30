package orchescala.helper.dev

import orchescala.helper.dev.update.*

class OrchSpecGeneratorTest extends munit.FunSuite:

  lazy val scalaExport =
    os.read(os.pwd / "04-helper" / "src" / "test" / "resources" / "orchSpec" / "kundenkontakt-scala.scala")
  lazy val files  = OrchSpecExport.parse(scalaExport)

  test("parse splits the export into its files"):
    assertEquals(
      files.map(f => f.path.last -> f.insert),
      Seq("KundenkontaktDokumentieren.scala" -> true, "CreateContactNote.scala" -> false)
    )
    assert(files(1).content.startsWith("package valiant.addresschange.domain.kundenkontaktDokumentieren.v1"))
    assert(files(1).content.endsWith("end CreateContactNote\n"))

  test("parse drops the section headers"):
    val withSections =
      s"""// ${"═" * 72}
         |// Gemeinsame Klassen
         |// ${"═" * 72}
         |
         |// ${"─" * 72}
         |// 01-domain/src/main/scala/a/b/domain/proc/v1/schema/Foo.scala
         |// ${"─" * 72}
         |
         |package a.b.domain.proc.v1.schema
         |
         |enum Foo:
         |  case x
         |
         |// ${"═" * 72}
         |// Ereignis-Subprozess «Cancel»
         |// ${"═" * 72}
         |
         |// ${"─" * 72}
         |// 01-domain/src/main/scala/a/b/domain/proc/v1/CancelSE.scala
         |// ${"─" * 72}
         |
         |package a.b.domain.proc.v1
         |""".stripMargin
    val parsed       = OrchSpecExport.parse(withSections)
    assertEquals(parsed.map(_.content), Seq("package a.b.domain.proc.v1.schema\n\nenum Foo:\n  case x\n", "package a.b.domain.proc.v1\n"))
    assertEquals(OrchSpecExport.processDir(parsed), os.rel / "01-domain" / "src" / "main" / "scala" / "a" / "b" / "domain" / "proc" / "v1")

  test("interaction"):
    assertEquals(OrchSpecExport.interaction(files(1).content), Some("CreateContactNote" -> "CustomTask"))

  test("processId takes the executable process"):
    val bpmn =
      """<bpmn:process id="other" isExecutable="false"></bpmn:process>
        |<bpmn:process id="valiant-addresschange-kundenkontaktDokumentierenV1" name="x" isExecutable="true">""".stripMargin
    assertEquals(OrchSpecExport.processId(bpmn), Some("valiant-addresschange-kundenkontaktDokumentierenV1"))

  test("withImport adds the import after the package"):
    assertEquals(
      OrchSpecExport.withImport("package a.b\n\nobject X\n", "import a.b.schema.*"),
      "package a.b\n\nimport a.b.schema.*\n\nobject X\n"
    )

  lazy val processObject = OrchSpecProcessObject(
    "valiant.addresschange.domain.kundenkontaktDokumentieren.v1",
    "KundenkontaktDokumentieren",
    "valiant-addresschange-kundenkontaktDokumentierenV1",
    files.head.content
  )

  test("process object - imports, name and examples"):
    val content = processObject.content
    assert(content.startsWith("package valiant.addresschange.domain.kundenkontaktDokumentieren.v1\n\nimport io.github.iltotore.iron.*\n"))
    assert(content.contains("import valiant.graviton.domain.work.v1.PostWorkActivity\n"))
    assert(content.contains("object KundenkontaktDokumentieren extends CompanyBpmnProcessDsl:"))
    assert(content.contains("""  val processName = "valiant-addresschange-kundenkontaktDokumentierenV1""""))
    assert(content.contains("    InitIn.exampleMinimal\n  )\nend KundenkontaktDokumentieren\n"))
    assert(!content.contains("// in object"))
    assert(processObject.hasInitIn)

  test("process object - In gets the inConfig"):
    assert(processObject.content.contains(
      """      shabNumber: Option[String],
        |      @description("A way to override process configuration.\n\n**SHOULD NOT BE USED on Production!**")
        |      inConfig: Option[InConfig] = None
        |  ) extends WithConfig[InConfig]:
        |    lazy val defaultConfig = InConfig()
        |
        |  object In:""".stripMargin
    ))

  test("process object - Out is added if missing"):
    assert(processObject.content.contains("  case class Out()\n"))
    assert(!processObject.content.contains("  case class InitIn()"))

  test("process object - without export block"):
    val empty = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", "")
    assert(empty.content.contains("  ) extends WithConfig[InConfig]:"))
    assert(empty.content.contains("  case class InConfig()"))
    assert(empty.content.contains("  case class InitIn()"))
    assert(!empty.hasInitIn)

  test("process object - enum In gets the inConfig in each case"):
    val block =
      """// in object Proc einfügen
        |
        |  enum In:
        |    def clientKey: Long
        |
        |    case Standard(
        |        clientKey: Long,
        |        amount: Int
        |    )
        |    case Empty
        |  end In
        |
        |  object In:
        |    given ApiSchema[In]  = deriveApiSchema
        |    given InOutCodec[In] = deriveInOutCodec
        |
        |    lazy val example = In.Empty
        |  end In""".stripMargin
    val obj   = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", block)
    assert(obj.content.contains(
      """  enum In extends WithConfig[InConfig]:
        |    lazy val defaultConfig = InConfig()
        |
        |    def clientKey: Long
        |
        |    case Standard(
        |        clientKey: Long,
        |        amount: Int,
        |        @description("A way to override process configuration.\n\n**SHOULD NOT BE USED on Production!**")
        |        inConfig: Option[InConfig] = None
        |    )
        |    case Empty(
        |        @description("A way to override process configuration.\n\n**SHOULD NOT BE USED on Production!**")
        |        inConfig: Option[InConfig] = None
        |    )
        |  end In""".stripMargin
    ), obj.content)
    assert(obj.content.contains("    lazy val example = In.Empty()\n"))
    assert(obj.content.contains("    In.example,\n    Out.exampleMinimal,"))
    assertEquals(obj.warnings, Seq.empty)

  test("process object - enum In without fields gives a warning"):
    val obj = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", "  enum In:\n    case a, b\n  end In")
    assert(!obj.content.contains("WithConfig[InConfig]:"))
    assertEquals(obj.warnings.size, 1)

  lazy val workerRegistration = OrchSpecRegistration(
    "WorkerApp",
    "workers(",
    "procWorkers",
    """  private lazy val procWorkers =
      |    Seq(ProcWorker())
      |  end procWorkers""".stripMargin
  )

  test("registration - adds the name to the list and the block at the end"):
    val workerApp =
      """object WorkerApp extends CompanyWorkerApp:
        |  workers(
        |    //TODO add workers here
        |  )
        |  dependencies(
        |  )
        |end WorkerApp
        |""".stripMargin
    assertEquals(
      workerRegistration.register(workerApp),
      Right(Some(
        """object WorkerApp extends CompanyWorkerApp:
          |  workers(
          |    procWorkers,
          |    //TODO add workers here
          |  )
          |  dependencies(
          |  )
          |
          |  private lazy val procWorkers =
          |    Seq(ProcWorker())
          |  end procWorkers
          |
          |end WorkerApp
          |""".stripMargin
      ))
    )

  test("registration - nothing to do if registered"):
    val registered = workerRegistration.register(
      "object WorkerApp:\n  workers(\n  )\nend WorkerApp\n"
    ).toOption.flatten.get
    assertEquals(workerRegistration.register(registered), Right(None))

  test("registration - unexpected form"):
    assert(workerRegistration.register("object WorkerApp:\n  val x = 1\n").isLeft)

  test("names from the process id - like Orch Spec"):
    assertEquals(
      OrchSpecNames("valiant-addresschange-kundenkontakt-dokumentieren", "valiant-addresschange"),
      OrchSpecNames("kundenkontaktDokumentieren", 1, "KundenkontaktDokumentieren")
    )
    assertEquals(
      OrchSpecNames("globex-savings-openSavingsV2", "globex-savings"),
      OrchSpecNames("openSavings", 2, "OpenSavingsV2")
    )
    assertEquals(
      OrchSpecNames("globex-ordercard", "globex-ordercard"),
      OrchSpecNames("ordercard", 1, "Ordercard")
    )

  test("parse - the insert mark does not depend on its text"):
    val header = s"// ${"─" * 72}"
    val parsed = OrchSpecExport.parse(s"$header\n// 01-domain/src/main/scala/a/b/domain/p/v1/P.scala  (in die bestehende Datei einf??gen)\n$header\n\n  case class In()\n")
    assertEquals(parsed.map(f => f.path.last -> f.insert), Seq("P.scala" -> true))

  // like `helperCommand` in Orch Spec: base64url(gzip(JSON)) without padding
  private def command(json: String) =
    val bytes = java.io.ByteArrayOutputStream()
    val zip   = java.util.zip.GZIPOutputStream(bytes)
    zip.write(json.getBytes("UTF-8"))
    zip.close()
    OrchSpecInput.commandPrefix + java.util.Base64.getUrlEncoder.withoutPadding.encodeToString(bytes.toByteArray)

  test("fromCommand - BPMN and Scala classes"):
    assertEquals(
      OrchSpecInput.fromCommand(command("""{"v":1,"bpmn":"<bpmn/>","scala":"// einfügen «x»"}""")),
      Some("<bpmn/>") -> "// einfügen «x»"
    )

  test("fromCommand - without BPMN"):
    assertEquals(OrchSpecInput.fromCommand(command("""{"v":1,"scala":"x"}""")), None -> "x")

  test("fromCommand - unknown version"):
    intercept[IllegalArgumentException](OrchSpecInput.fromCommand(command("""{"v":2,"scala":"x"}""")))

  test("fromCommand - not readable"):
    intercept[IllegalArgumentException](OrchSpecInput.fromCommand("orchspec:no-gzip"))

end OrchSpecGeneratorTest
