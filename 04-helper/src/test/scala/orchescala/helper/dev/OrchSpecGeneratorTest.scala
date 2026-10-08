package orchescala.helper.dev

import orchescala.domain.BpmnProcessType
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

  test("interaction - In and Out as another type (alias) with deviating example values"):
    val content =
      """package acme.demo.domain.orderCard.v1
        |
        |object PostProcessCardUT extends CompanyBpmnUserTaskDsl:
        |
        |  val name = "PostprocessKUBETask"
        |  val descr: String = ""
        |
        |  type In = OrderCardUT.In
        |
        |  type Out = PostProcessOrderUT.Out
        |
        |  lazy val example = userTask(
        |    OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false),
        |    PostProcessOrderUT.Out.example
        |  )
        |end PostProcessCardUT
        |""".stripMargin
    assertEquals(OrchSpecExport.interaction(content), Some("PostProcessCardUT" -> "UserTask"))
    assertEquals(OrchSpecExport.differences(content, content), Seq.empty)

  test("workers only for the custom tasks of the process - not for user tasks, signals, messages"):
    val interactions = Seq(
      ("PrepareOrderCard", "CustomTask", Some("valiant-product-orderCard-PrepareOrderCard")),
      ("CreateAllPoa", "CustomTask", Some("valiant-product-orderCardV1-CreateAllPoaStatus90")),
      ("ApproveOrder", "UserTask", None),
      ("WaitForPreview", "SignalEvent", None),
      ("CardDelivered", "MessageEvent", None),
      // a worker of another project - exists there already
      ("AdjustProcessVariables", "CustomTask", Some("valiant-addresschange-addressChangeV1-AdjustProcessVariables"))
    )
    assertEquals(
      OrchSpecExport.workerNames(interactions, "valiant-product-orderCard"),
      Seq("PrepareOrderCard", "CreateAllPoa")
    )

  test("a custom task of another project is foreign - neither domain object nor worker"):
    def task(topic: String) = s"object T extends CompanyBpmnCustomTaskDsl:\n  val topicName = \"$topic\"\n"
    val processId = "valiant-product-orderCard"
    assert(!OrchSpecExport.isForeign(task("valiant-product-orderCard-PrepareOrderCard"), processId))
    assert(!OrchSpecExport.isForeign(task("valiant-product-orderCardV1-CreateAllPoaStatus90"), processId))
    assert(OrchSpecExport.isForeign(task("valiant-addresschange-addressChangeV1-AdjustProcessVariables"), processId))
    // the others decides the export of Orch Spec (with the catalog) - and plain classes are always own
    assert(!OrchSpecExport.isForeign("object X extends CompanyBpmnUserTaskDsl:\n  val name = \"T\"\n", processId))
    assert(!OrchSpecExport.isForeign("case class Address(street: String)\n", processId))

  test("topicName of a worker object"):
    val content = "object Check extends CompanyBpmnCustomTaskDsl:\n  val topicName     = \"valiant-product-orderCard-Check\"\n"
    assertEquals(OrchSpecExport.topicName(content), Some("valiant-product-orderCard-Check"))
    assertEquals(OrchSpecExport.topicName("object X extends CompanyBpmnUserTaskDsl:\n  val name = \"T\"\n"), None)

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
    assert(content.startsWith("package valiant.addresschange.domain\npackage kundenkontaktDokumentieren.v1\n\nimport io.github.iltotore.iron.*\n"))
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
        |  end In
        |
        |  object In:""".stripMargin
    ))

  test("process object - the examples of In leave the inConfig at its default None"):
    assert(processObject.content.contains("      shabNumber = Some(\"Beispiel\")\n    )"), processObject.content)
    assert(!processObject.content.contains("inConfig = None\n"), processObject.content)
    val empty = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", "")
    assert(empty.content.contains("    lazy val example = In()"))

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

  private def workers(entries: Seq[String]) = OrchSpecRegistration(
    "WorkerApp",
    "workers(",
    "procWorkers",
    entries,
    es => s"""  private lazy val procWorkers =
             |    Seq(
             |${es.map(e => s"      $e,").mkString("\n")}
             |    )
             |  end procWorkers""".stripMargin
  )
  lazy val workerRegistration = workers(Seq("ProcWorker()"))

  private def registered(result: RegistrationResult): String = result match
    case RegistrationResult.Registered(content, _) => content
    case other                                     => fail(s"not registered: $other")

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
      registered(workerRegistration.register(workerApp)),
      """object WorkerApp extends CompanyWorkerApp:
        |  workers(
        |    procWorkers,
        |    //TODO add workers here
        |  )
        |  dependencies(
        |  )
        |
        |  private lazy val procWorkers =
        |    Seq(
        |      ProcWorker(),
        |    )
        |  end procWorkers
        |
        |end WorkerApp
        |""".stripMargin
    )

  lazy val registeredApp =
    registered(workerRegistration.register("object WorkerApp:\n  workers(\n  )\nend WorkerApp\n"))

  test("registration - nothing to do if registered"):
    assertEquals(workerRegistration.register(registeredApp), RegistrationResult.Unchanged)

  test("registration - a re-run adds the missing entries to the block"):
    val result = workers(Seq("ProcWorker()", "CheckWorker()")).register(registeredApp)
    assertEquals(result match { case RegistrationResult.Registered(_, added) => added; case _ => Nil }, Seq("CheckWorker()"))
    assert(registered(result).contains("      ProcWorker(),\n      CheckWorker(),\n    )\n  end procWorkers"))

  test("registration - a re-run adds a comma to the last entry"):
    val handWritten =
      """object WorkerApp:
        |  workers(
        |    procWorkers
        |  )
        |  private lazy val procWorkers =
        |    val client = Client()
        |    Seq(
        |      ProcWorker(client)
        |    )
        |  end procWorkers
        |end WorkerApp
        |""".stripMargin
    assert(registered(workers(Seq("ProcWorker()", "CheckWorker()")).register(handWritten))
      .contains("      ProcWorker(client),\n      CheckWorker(),\n    )"))

  test("registration - a re-run fills an empty api"):
    val api      = OrchSpecRegistration(
      "ApiProjectCreator",
      "document(",
      "procApi",
      Seq("CheckUT.example"),
      _ => ""
    )
    val existing =
      """object ApiProjectCreator:
        |  document(
        |    procApi,
        |  )
        |  private lazy val procApi =
        |    api(Proc.example)()
        |  end procApi
        |end ApiProjectCreator
        |""".stripMargin
    assert(registered(api.register(existing)).contains("    api(Proc.example)(\n      CheckUT.example,\n    )\n  end procApi"))

  private def apiOf(name: String) = OrchSpecRegistration(
    "ApiProjectCreator",
    "document(",
    name,
    Seq("CheckUT.example"),
    _ => s"  private lazy val $name =\n    api(X.example)()\n  end $name"
  )
  // as ApiGenerator writes it - with the example in a block comment - and one process registered
  private lazy val generatedApi =
    """object ApiProjectCreator extends CompanyApiCreator:
      |  document(
      |    updateAvailabilityApi,
      |    //myProcessApi,
      |  )
      |
      |  /* example:
      |  private lazy val myProcessApi =
      |    import myProcess.v1.*
      |    api(MyProcess.example)(
      |      // userTasks / workers etc.
      |    )
      |  */
      |
      |  private lazy val updateAvailabilityApi =
      |    api(UpdateAvailability.example)()
      |  end updateAvailabilityApi
      |end ApiProjectCreator
      |""".stripMargin

  test("registration - a block in a comment is no neighbour: the new block stays outside"):
    // `bookAppointmentApi` comes before `myProcessApi` - it went into the example
    val result  = registered(apiOf("bookAppointmentApi").register(generatedApi))
    val comment = result.indexOf("  */")
    val block   = result.indexOf("  private lazy val bookAppointmentApi")
    assert(block > comment, result)
    assert(block < result.indexOf("  private lazy val updateAvailabilityApi"), result)
    assert(result.contains("    bookAppointmentApi,\n    updateAvailabilityApi,"), result)

  test("registration - a block in a comment is not registered yet"):
    val result = registered(apiOf("myProcessApi").register(generatedApi))
    // into the list (the commented entry is none) and as a block after the comment
    assert(result.contains("    myProcessApi,\n    updateAvailabilityApi,\n    //myProcessApi,"), result)
    assert(result.indexOf("  end myProcessApi") > result.indexOf("  */"), result)
    assertEquals("lazy val myProcessApi".r.findAllIn(result).size, 2, "the example and the new block")

  /** `procApi` is registered - with `line` somewhere above it. A re-run must find it. */
  private def withLine(line: String) =
    s"""object ApiProjectCreator extends CompanyApiCreator:
       |  document(
       |    procApi,
       |  )
       |$line
       |  private lazy val procApi =
       |    api(Proc.example)(
       |      CheckUT.example,
       |    )
       |  end procApi
       |end ApiProjectCreator
       |""".stripMargin

  test("registration - `/*` in a line comment, a string or a character opens no comment"):
    for line <- Seq(
        "  // use /* to disable a process",
        "  private val glob = \"src/*\"",
        "  private val doc = \"\"\"a /* in a\n    |multi-line string\"\"\"",
        "  private val c = '/'; private val star = \"*\" // '/' + \"*\""
      )
    do assertEquals(apiOf("procApi").register(withLine(line)), RegistrationResult.Unchanged, line)

  test("registration - a comment in front of the val on the same line"):
    val oneLine = withLine("").replace("  private lazy val procApi =", "  /* the proc */ private lazy val procApi =")
    assertEquals(apiOf("procApi").register(oneLine), RegistrationResult.Unchanged)

  test("registration - nested comments: the block stays hidden until the outer one closes"):
    val nested = withLine("").replace(
      "  private lazy val procApi =",
      "  /* outer /* inner */\n  private lazy val otherApi =\n  */\n  private lazy val procApi ="
    )
    assertEquals(apiOf("procApi").register(nested), RegistrationResult.Unchanged)
    val result = registered(apiOf("otherApi").register(nested))
    assertEquals("lazy val otherApi".r.findAllIn(result).size, 2, result)
    assert(result.indexOf("  end otherApi") > result.indexOf("  */"), result)

  test("registration - unexpected form"):
    assert(workerRegistration.register("object WorkerApp:\n  val x = 1\n").isInstanceOf[RegistrationResult.Manual])

  test("differences - whole file, blanks at the line ends do not count"):
    assertEquals(OrchSpecExport.differences("a  \nb\n\n", "a\nb"), Seq.empty)
    assertEquals(OrchSpecExport.differences("a\nc", "a\nb"), Seq(OrchSpecExport.whole))

  test("differences - process object: only the types of the export and the imports"):
    val implemented = processObject.content
      .replace("""val descr: String = """"", """val descr: String = "Documents the contact."""")
      .replace("    InitIn.exampleMinimal\n  )", "    InitIn.example\n  )")
    assertEquals(processObject.differences(implemented), Seq.empty)
    val changedIn   = implemented.replace("      shabNumber: Option[String],", "      shabNumber: Option[String],\n      newField: Int,")
    assertEquals(processObject.differences(changedIn), Seq("In"))
    val noImport    = implemented.replace("import valiant.graviton.domain.work.v1.PostWorkActivity\n", "")
    assertEquals(processObject.differences(noImport), Seq("imports"))

  test("object name - the exported one while its file exists, otherwise without the version"):
    assertEquals(OrchSpecNames.objectName(Some("ModuleDebitInsuranceV1"), "ModuleDebitInsurance", _ => true), "ModuleDebitInsuranceV1")
    assertEquals(OrchSpecNames.objectName(Some("ModuleDebitInsuranceV1"), "ModuleDebitInsurance", _ => false), "ModuleDebitInsurance")
    assertEquals(OrchSpecNames.objectName(None, "ModuleDebitInsurance", _ => true), "ModuleDebitInsurance")

  test("names from the process id - like Orch Spec"):
    assertEquals(
      OrchSpecNames("valiant-addresschange-kundenkontakt-dokumentieren", "valiant-addresschange"),
      OrchSpecNames("kundenkontaktDokumentieren", 1, "KundenkontaktDokumentieren")
    )
    assertEquals(
      OrchSpecNames("globex-savings-openSavingsV2", "globex-savings"),
      OrchSpecNames("openSavings", 2, "OpenSavings")
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
      OrchSpecCommand(Some("<bpmn/>"), "// einfügen «x»")
    )

  test("fromCommand - with the DMN tables"):
    assertEquals(
      OrchSpecInput.fromCommand(command("""{"v":1,"scala":"x","dmns":[{"file":"product-subStatusKey.dmn","xml":"<definitions/>"}]}""")).dmns,
      Seq("product-subStatusKey.dmn" -> "<definitions/>")
    )

  test("dmn - file name without a path, engine from the modeler"):
    assertEquals(OrchSpecExport.dmnFileName("../a/b.dmn"), "b.dmn")
    assertEquals(OrchSpecExport.dmnFileName("subStatus"), "subStatus.dmn")
    assert(OrchSpecExport.isC8Dmn("""<definitions modeler:executionPlatform="Camunda Cloud">"""))
    assert(!OrchSpecExport.isC8Dmn("""<definitions modeler:executionPlatform="Camunda Platform">"""))

  test("fromCommand - without BPMN"):
    assertEquals(OrchSpecInput.fromCommand(command("""{"v":1,"scala":"x"}""")), OrchSpecCommand(None, "x"))

  test("fromCommand - unknown version"):
    intercept[IllegalArgumentException](OrchSpecInput.fromCommand(command("""{"v":2,"scala":"x"}""")))

  test("fromCommand - not readable"):
    intercept[IllegalArgumentException](OrchSpecInput.fromCommand("orchspec:no-gzip"))

  test("process object - customInit of the init worker from the export"):
    val block =
      """// oben in der Datei ergänzen:
        |// import a.b.X
        |
        |// im InitWorker (customInit):
        |// InitIn(
        |//   fee = in.fee.getOrElse(90)
        |// )
        |
        |// in object Proc einfügen
        |
        |  case class In(
        |      fee: Option[Int]
        |  )""".stripMargin
    val obj   = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", block)
    assertEquals(obj.customInit, Some("InitIn(\n  fee = in.fee.getOrElse(90)\n)"))
    assert(!obj.content.contains("getOrElse"), "the customInit belongs to the worker, not to the domain")
    assertEquals(processObject.customInit, None)

  private def blockOf(name: String) = OrchSpecRegistration(
    "WorkerApp",
    "workers(",
    name,
    Seq("X()"),
    _ => s"  private lazy val $name =\n    Seq()\n  end $name"
  )
  private lazy val sortedApp =
    """object WorkerApp extends CompanyWorkerApp:
      |  workers(
      |    aWorkers,
      |    cWorkers
      |  )
      |
      |  private lazy val aWorkers =
      |    Seq()
      |  end aWorkers
      |
      |  // the c process
      |  private lazy val cWorkers =
      |    Seq()
      |  end cWorkers
      |end WorkerApp
      |""".stripMargin

  test("registration - the process goes alphabetically into the list and among the blocks"):
    assertEquals(
      registered(blockOf("bWorkers").register(sortedApp)),
      """object WorkerApp extends CompanyWorkerApp:
        |  workers(
        |    aWorkers,
        |    bWorkers,
        |    cWorkers
        |  )
        |
        |  private lazy val aWorkers =
        |    Seq()
        |  end aWorkers
        |
        |  private lazy val bWorkers =
        |    Seq()
        |  end bWorkers
        |
        |  // the c process
        |  private lazy val cWorkers =
        |    Seq()
        |  end cWorkers
        |end WorkerApp
        |""".stripMargin
    )

  test("registration - the last one alphabetically goes to the end"):
    val result = registered(blockOf("dWorkers").register(sortedApp))
    assert(result.contains("    cWorkers,\n    dWorkers,\n  )"), result)
    assert(result.contains("  end cWorkers\n\n  private lazy val dWorkers =\n    Seq()\n  end dWorkers\n\nend WorkerApp"), result)

  // ── merge into an existing process object ───────────────────────────────────
  private lazy val mergeBlock =
    """// oben in der Datei ergänzen:
      |// import a.b.domain.other.v1.GetClient
      |// import a.b.domain.other.v1.GetAccount
      |// import x.y.Status
      |
      |// descr: Neue Karte
      |// processLabels: Neue Karte | Nouvelle carte
      |
      |// in object Proc einfügen
      |
      |  case class In(
      |      clientKey: Long,
      |      amount: Int
      |  )
      |
      |  object In:
      |    given ApiSchema[In]  = deriveApiSchema
      |    given InOutCodec[In] = deriveInOutCodec
      |
      |    lazy val example = In(
      |      clientKey = 1L,
      |      amount = 2
      |    )
      |    lazy val exampleMinimal = example
      |  end In
      |
      |  case class InitIn(
      |      counter: Int = 0
      |  )
      |
      |  object InitIn:
      |    given ApiSchema[InitIn]  = deriveApiSchema
      |    given InOutCodec[InitIn] = deriveInOutCodec
      |
      |    lazy val example = InitIn()
      |    lazy val exampleMinimal = example
      |  end InitIn
      |
      |  case class InConfig(
      |      timer: String = "PT1M",
      |      getClientMock: Option[GetClient.Out] = None
      |  )
      |
      |  object InConfig:
      |    given ApiSchema[InConfig]  = deriveApiSchema
      |    given InOutCodec[InConfig] = deriveInOutCodec
      |  end InConfig
      |
      |  case class Out(
      |      done: Boolean
      |  )
      |
      |  object Out:
      |    given ApiSchema[Out]  = deriveApiSchema
      |    given InOutCodec[Out] = deriveInOutCodec
      |
      |    lazy val example = Out(done = true)
      |    lazy val exampleMinimal = example
      |  end Out
      |
      |  enum CustomStatus:
      |    case ordered
      |
      |  object CustomStatus:
      |    given ApiSchema[CustomStatus]  = deriveEnumApiSchema
      |    given InOutCodec[CustomStatus] = deriveEnumInOutCodec
      |
      |    lazy val example = CustomStatus.ordered
      |  end CustomStatus""".stripMargin

  private lazy val mergeObject = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", mergeBlock)

  private val existingProc =
    """package a.b
      |package domain.proc.v1
      |
      |import a.b.domain.other.v1.{GetAccount, GetClient}
      |
      |object Proc extends CompanyBpmnProcessDsl:
      |
      |  val processName   = "a-b-procV1"
      |  val descr: String = "Neubestellung"
      |
      |  override def processLabels: ProcessLabels =
      |    ProcessLabels("Neubestellung", "Nouvelle commande")
      |
      |  case class In(
      |      clientKey: Long,
      |      inConfig: Option[InConfig] = None
      |  ) extends WithConfig[InConfig]:
      |    lazy val defaultConfig = InConfig()
      |  end In
      |  object In:
      |    given ApiSchema[In]  = deriveApiSchema
      |    given InOutCodec[In] = deriveInOutCodec
      |    lazy val example = In(clientKey = 1L)
      |  end In
      |
      |  case class InConfig(
      |      // Mocks
      |      @description("own mock")
      |      getClientNextDayMock: Option[
      |        GetClient.Out
      |      ] = None
      |  )
      |  object InConfig:
      |    given ApiSchema[InConfig]  = deriveApiSchema
      |    given InOutCodec[InConfig] = deriveInOutCodec
      |
      |  case class Out(done: Boolean)
      |  object Out:
      |    given ApiSchema[Out]  = deriveApiSchema
      |    given InOutCodec[Out] = deriveInOutCodec
      |    lazy val example = Out(done = true)
      |    lazy val exampleMinimal = example
      |  end Out
      |
      |  lazy val example = process(
      |    In.example,
      |    Out.example,
      |    InitIn.example
      |  ).withEnumOutExamples(Out.example)
      |end Proc
      |""".stripMargin

  private lazy val merged = mergeObject.merge(existingProc)

  test("merge - keeps package, descr, processLabels and the examples of the process"):
    assert(merged.startsWith("package a.b\npackage domain.proc.v1\n"), merged)
    assert(merged.contains("""  val descr: String = "Neubestellung""""), merged)
    assert(merged.contains("""    ProcessLabels("Neubestellung", "Nouvelle commande")"""), merged)
    assert(merged.contains("  ).withEnumOutExamples(Out.example)\nend Proc\n"), merged)

  test("merge - In is replaced, the missing InitIn goes after it, the other types after Out"):
    assert(merged.contains("      amount: Int,\n"), merged)
    val order = Seq("  case class In(", "  case class InitIn(", "  case class InConfig(", "  case class Out(", "  enum CustomStatus:")
      .map(merged.indexOf)
    assert(order.forall(_ >= 0) && order == order.sorted, merged)

  test("merge - InConfig only gets the missing fields, its own mocks stay"):
    assert(merged.contains(
      """  case class InConfig(
        |      // Mocks
        |      @description("own mock")
        |      getClientNextDayMock: Option[
        |        GetClient.Out
        |      ] = None,
        |      timer: String = "PT1M",
        |      getClientMock: Option[GetClient.Out] = None
        |  )""".stripMargin
    ), merged)

  test("merge - only imports that are missing"):
    val imports = merged.linesIterator.filter(_.startsWith("import ")).toSeq
    assertEquals(imports, Seq("import a.b.domain.other.v1.{GetAccount, GetClient}", "import x.y.Status"))

  test("merge - a type that differs only in blanks stays as it is"):
    assert(merged.contains("  case class Out(done: Boolean)\n"), merged)
    assert(!mergeObject.differences(existingProc).contains("Out"), mergeObject.differences(existingProc))

  test("merge - nothing to do the second time"):
    assertEquals(mergeObject.differences(merged), Seq.empty)
    assertEquals(mergeObject.merge(merged), merged)

  test("merge - a field without default in InitIn also goes into its example"):
    val block    =
      """// in object Proc einfügen
        |
        |  case class InitIn(
        |      @description("a = b")
        |      counter: Int = 0,
        |      @description("the fee")
        |      fee: Int,
        |      flag: Boolean = false
        |  )
        |
        |  object InitIn:
        |    given ApiSchema[InitIn]  = deriveApiSchema
        |    given InOutCodec[InitIn] = deriveInOutCodec
        |
        |    lazy val example = InitIn(
        |      counter = 0,
        |      fee = 90,
        |      flag = false
        |    )
        |  end InitIn""".stripMargin
    val existing =
      """package a.b
        |package domain.proc.v1
        |
        |object Proc extends CompanyBpmnProcessDsl:
        |
        |  val processName   = "a-b-procV1"
        |  val descr: String = "x"
        |
        |  case class InitIn(
        |      counter: Int = 0
        |  )
        |  object InitIn:
        |    given ApiSchema[InitIn]  = deriveApiSchema
        |    given InOutCodec[InitIn] = deriveInOutCodec
        |
        |    lazy val example = InitIn(
        |      counter = 1
        |    )
        |  end InitIn
        |end Proc
        |""".stripMargin
    val m        = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", block).merge(existing)
    assert(m.contains("      counter: Int = 0,\n      @description(\"the fee\")\n      fee: Int,\n      flag: Boolean = false\n  )"), m)
    // only the field without default - the own value of counter stays
    assert(m.contains("    lazy val example = InitIn(\n      counter = 1,\n      fee = 90\n    )"), m)
    assertEquals(OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", block).merge(m), m)

  test("merge - an empty example of InitIn gets the field without default"):
    val block    =
      """// in object Proc einfügen
        |
        |  case class InitIn(
        |      fee: Int
        |  )
        |
        |  object InitIn:
        |    lazy val example = InitIn(
        |      fee = 90
        |    )
        |  end InitIn""".stripMargin
    val existing =
      """object Proc extends CompanyBpmnProcessDsl:
        |
        |  val processName   = "a-b-procV1"
        |  val descr: String = "x"
        |
        |  case class InitIn()
        |  object InitIn:
        |    lazy val example = InitIn()
        |  end InitIn
        |end Proc
        |""".stripMargin
    val m        = OrchSpecProcessObject("a.b.domain.proc.v1", "Proc", "a-b-procV1", block).merge(existing)
    assert(m.contains("    lazy val example = InitIn(\n      fee = 90\n    )"), m)

  test("merge - processLabels go in when the object has none"):
    val without = existingProc.replace(
      "  override def processLabels: ProcessLabels =\n    ProcessLabels(\"Neubestellung\", \"Nouvelle commande\")\n\n",
      ""
    )
    assert(mergeObject.differences(without).contains("processLabels"), mergeObject.differences(without))
    val m = mergeObject.merge(without)
    assert(
      m.contains(
        "  val descr: String = \"Neubestellung\"\n\n  override lazy val processLabels: ProcessLabels =\n    ProcessLabels(\"Neue Karte\", \"Nouvelle carte\")\n\n  case class In("
      ),
      m
    )
    assertEquals(mergeObject.merge(m), m)

  test("merge - an existing override val (or lazy val) processLabels is kept, none added"):
    for decl <- Seq("override val", "override lazy val") do
      val withVal = existingProc.replace("  override def processLabels", s"  $decl processLabels")
      assert(!mergeObject.differences(withVal).contains("processLabels"), mergeObject.differences(withVal))
      val m = mergeObject.merge(withVal)
      assertEquals(m.linesIterator.count(_.contains("processLabels: ProcessLabels")), 1, m)

  test("registration - a worker registered in a block of another name is not added again"):
    val workerApp =
      """object WorkerApp extends CompanyWorkerApp:
        |  workers(
        |    lilaSetV2Workers,
        |  )
        |
        |  private lazy val lilaSetV2Workers =
        |    import a.b.worker.lilaSet.v2.*
        |    Seq(
        |      LilaSetWorker(),
        |      MergeNewAccountsWorker()
        |    )
        |  end lilaSetV2Workers
        |end WorkerApp
        |""".stripMargin
    val registration = OrchSpecRegistration(
      "WorkerApp",
      "workers(",
      "lilaSetWorkers",
      Seq("LilaSetWorker()", "MergeNewAccountsWorker()"),
      entries => s"  private lazy val lilaSetWorkers =\n    Seq(\n${entries.map(e => s"      $e,").mkString("\n")}\n    )\n  end lilaSetWorkers"
    )
    assertEquals(registration.register(workerApp), RegistrationResult.Unchanged)
    // a new one goes into a block of its own - only that one
    registration.copy(entries = registration.entries :+ "CalcAgeWorker()").register(workerApp) match
      case RegistrationResult.Registered(content, _) =>
        assertEquals(content.linesIterator.count(_.contains("LilaSetWorker()")), 1, content)
        assert(content.contains("      CalcAgeWorker(),"), content)
      case other                                     => fail(other.toString)

  test("new process object - a descr of several lines is a stripMargin text"):
    val block = mergeObject.block.replace(
      "// descr: Neue Karte\n",
      "// descr: Neue Karte\n// descr|\n// descr| - mit \\\"Limite\\\"\n"
    )
    val content = mergeObject.copy(block = block).content
    assert(
      content.contains(
        "  lazy val descr: String =\n    \"\"\"Neue Karte\n      |\n      |- mit \"Limite\"\n      |\"\"\".stripMargin\n"
      ),
      content
    )

  test("merge - processLabels go after an override def descr of several lines"):
    val existing = existingProc
      .replace("  val descr: String = \"Neubestellung\"\n", "  override def descr =\n    \"\"\"Neubestellung\n      |\n      |- Karte\n      |\"\"\".stripMargin\n")
      .replace("  override def processLabels: ProcessLabels =\n    ProcessLabels(\"Neubestellung\", \"Nouvelle commande\")\n\n", "")
    val m = mergeObject.merge(existing)
    assert(m.contains("      |\"\"\".stripMargin\n\n  override lazy val processLabels: ProcessLabels =\n"), m)

  test("new process object - In, InitIn, InConfig, Out and the descr of the export"):
    val content = mergeObject.content
    assert(content.contains("""  lazy val descr: String = "Neue Karte""""), content)
    assert(content.contains("  override lazy val processLabels: ProcessLabels =\n    ProcessLabels(\"Neue Karte\", \"Nouvelle carte\")\n"), content)
    val order   = Seq("  case class In(", "  case class InitIn(", "  case class InConfig(", "  case class Out(", "  enum CustomStatus:")
      .map(content.indexOf)
    assert(order.forall(_ >= 0) && order == order.sorted, content)

  test("imports - covered by braces, wildcard, the same name or the package clause"):
    val lines = Seq("package a.b", "package domain.proc.v1", "", "import c.d.{X, Y}", "import e.f.*", "import g.h.Status")
    assert(OrchSpecImports.covered(lines, "import c.d.X"))
    assert(OrchSpecImports.covered(lines, "import e.f.Z"))
    assert(OrchSpecImports.covered(lines, "import i.j.Status"))
    assert(OrchSpecImports.covered(lines, "import a.b.Thing"))
    assert(OrchSpecImports.covered(lines, "import a.b.domain.proc.v1.Thing"))
    assert(!OrchSpecImports.covered(lines, "import a.b.domain.Thing"))
    assert(!OrchSpecImports.covered(lines, "import a.b.domain.proc.v1.schema.*"))

  test("processTypeOf - a C7/Op export goes to the project's engine"):
    assertEquals(OrchSpecGenerator.processTypeOf(BpmnProcessType.Op(), c8 = false), BpmnProcessType.Op())
    assertEquals(OrchSpecGenerator.processTypeOf(BpmnProcessType.C7(), c8 = false), BpmnProcessType.C7())

  test("processTypeOf - a C8 export in an Op project goes to the C8 path"):
    assertEquals(OrchSpecGenerator.processTypeOf(BpmnProcessType.Op(), c8 = true), BpmnProcessType.C8())

  test("processTypeOf - a C7 export in a C8 project goes to the C7 path"):
    assertEquals(OrchSpecGenerator.processTypeOf(BpmnProcessType.C8(), c8 = false), BpmnProcessType.C7())

  test("processTypeOf - a C8 export in a C8 project keeps the project's path"):
    val custom = BpmnProcessType.C8(os.rel / "bpmn8")
    assertEquals(OrchSpecGenerator.processTypeOf(custom, c8 = true), custom)

end OrchSpecGeneratorTest
