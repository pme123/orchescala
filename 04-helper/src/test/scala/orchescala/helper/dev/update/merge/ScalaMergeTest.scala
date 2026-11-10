package orchescala.helper.dev.update.merge

import munit.FunSuite

class ScalaMergeTest extends FunSuite:

  private val code =
    """package acme.crm.domain
      |package client.v1
      |
      |import acme.crm.domain.schema.*
      |
      |/** A client. */
      |case class Client(
      |    name: String
      |):
      |  def display: String = name.toUpperCase
      |end Client
      |
      |object Client:
      |  given ApiSchema[Client]  = deriveApiSchema
      |  given InOutCodec[Client] = deriveInOutCodec
      |  // own: the client of the tests
      |  lazy val ofTests = Client("test")
      |
      |  lazy val example = Client(
      |    name = "Peter"
      |  )
      |end Client
      |
      |case class Legacy(id: Long)
      |
      |object Legacy:
      |  lazy val example = Legacy(1L)
      |end Legacy
      |""".stripMargin

  private val spec =
    """package acme.crm.domain
      |package client.v1
      |
      |import acme.crm.domain.schema.Gender
      |import acme.other.Address
      |
      |/** A client of the bank. */
      |case class Client(
      |    name: String,
      |    gender: Gender
      |)
      |
      |object Client:
      |  given ApiSchema[Client]  = deriveApiSchema
      |  given InOutCodec[Client] = deriveInOutCodec
      |
      |  lazy val example = Client(
      |    name = "Peter",
      |    gender = Gender.Male
      |  )
      |  lazy val exampleMinimal = example
      |end Client
      |""".stripMargin

  test("the code is the basis: the spec's parameters and examples, the own members stay, a class only the code has is removable"):
    val r = ScalaMerge.merge(code, spec)
    assertEquals(
      r.text,
      """package acme.crm.domain
        |package client.v1
        |
        |import acme.crm.domain.schema.*
        |import acme.other.Address
        |
        |/** A client of the bank. */
        |case class Client(
        |    name: String,
        |    gender: Gender
        |):
        |  def display: String = name.toUpperCase
        |end Client
        |
        |object Client:
        |  given ApiSchema[Client]  = deriveApiSchema
        |  given InOutCodec[Client] = deriveInOutCodec
        |  // own: the client of the tests
        |  lazy val ofTests = Client("test")
        |
        |  lazy val example = Client(
        |    name = "Peter",
        |    gender = Gender.Male
        |  )
        |  lazy val exampleMinimal = example
        |end Client
        |
        |case class Legacy(id: Long)
        |
        |object Legacy:
        |  lazy val example = Legacy(1L)
        |end Legacy
        |""".stripMargin
    )
    assertEquals(r.removable, Seq("Legacy"))
    assert(!r.without.contains("Legacy"), r.without)
    assert(r.without.endsWith("end Client\n"), r.without)

  test("the same in another form: unchanged"):
    val reformatted = spec.replace("  given ApiSchema[Client]  = deriveApiSchema", "  given ApiSchema[Client] =\n    deriveApiSchema")
    val r           = ScalaMerge.merge(reformatted, spec)
    assertEquals(r.text, reformatted)
    assertEquals(r.removable, Seq.empty)

  private val enumCode =
    """package acme
      |
      |object GetClient extends ClientV1:
      |
      |  final val topicName = "acme-clientV1.GetClient"
      |
      |  enum Out:
      |    case Standard(
      |        clients: Seq[Client]
      |    )
      |    case ClientKey(
      |        client: Client
      |    )
      |    case Legacy
      |  end Out
      |
      |  object Out:
      |    private lazy val decoder: InOutDecoder[Out] = (c: HCursor) =>
      |      customDecodeAccumulating[Out.ClientKey](c).orElse:
      |        customDecodeAccumulating[Out.Standard](c)
      |  end Out
      |
      |  def helper(x: Int): Int = x + 1
      |end GetClient
      |""".stripMargin

  private val enumSpec =
    """package acme
      |
      |object GetClient extends ClientV1:
      |
      |  final val topicName = "acme-clientV1.GetClient"
      |  val path = "GET: /clients"
      |
      |  enum Out:
      |    case Standard(
      |        clients: Seq[Client]
      |    )
      |    @description("For one client")
      |    case ClientKey(
      |        client: Client,
      |        found: Boolean
      |    )
      |  end Out
      |
      |  object Out:
      |    private lazy val decoder: InOutDecoder[Out] = (c: HCursor) =>
      |      // TODO the JSON names no case: the first case that reads it wins
      |      customDecodeAccumulating[Out.Standard](c)
      |        .orElse(customDecodeAccumulating[Out.ClientKey](c))
      |  end Out
      |end GetClient
      |""".stripMargin

  test("an enum: the cases of the spec, a case only the code has is removable, the own decoder and def stay"):
    val r = ScalaMerge.merge(enumCode, enumSpec)
    assertEquals(
      r.text,
      """package acme
        |
        |object GetClient extends ClientV1:
        |
        |  final val topicName = "acme-clientV1.GetClient"
        |  val path = "GET: /clients"
        |
        |  enum Out:
        |    case Standard(
        |        clients: Seq[Client]
        |    )
        |    @description("For one client")
        |    case ClientKey(
        |        client: Client,
        |        found: Boolean
        |    )
        |    case Legacy
        |  end Out
        |
        |  object Out:
        |    private lazy val decoder: InOutDecoder[Out] = (c: HCursor) =>
        |      customDecodeAccumulating[Out.ClientKey](c).orElse:
        |        customDecodeAccumulating[Out.Standard](c)
        |  end Out
        |
        |  def helper(x: Int): Int = x + 1
        |end GetClient
        |""".stripMargin
    )
    assertEquals(r.removable, Seq("GetClient.Out.Legacy"))
    assert(!r.without.contains("case Legacy"), r.without)
    assert(r.without.contains("def helper"), r.without)

  test("indented otherwise than the spec: what is added gets the indentation of the code"):
    val code4 = enumCode.linesIterator.map(l => if l.startsWith("  ") then "  " + l else l).mkString("\n") + "\n"
    val r     = ScalaMerge.merge(code4, enumSpec)
    assert(r.text.contains("\n    val path = \"GET: /clients\"\n"), r.text)
    assert(r.text.contains("\n      @description(\"For one client\")\n      case ClientKey("), r.text)

  test("a class only the spec has: added after the one it follows"):
    val r = ScalaMerge.merge(spec, spec + "\ncase class Address(street: String)\n")
    assert(r.text.endsWith("end Client\n\ncase class Address(street: String)\n"), r.text)
    assertEquals(r.removable, Seq.empty)

  test("a shared field of an enum Orch Spec no longer has: removable like a case - an own def with a value stays"):
    val code = """object GetClient:
                 |  enum In:
                 |    @description("From the source of truth")
                 |    def readFromFcs: Option[Boolean]
                 |    def dummy: Seq[String]
                 |    def label: String = readFromFcs.toString
                 |
                 |    case Standard(
                 |        readFromFcs: Option[Boolean],
                 |        dummy: Seq[String]
                 |    )
                 |  end In
                 |end GetClient
                 |""".stripMargin
    val spec = """object GetClient:
                 |  enum In:
                 |    @description("From the source of truth")
                 |    def readFromFcs: Option[Boolean]
                 |
                 |    case Standard(
                 |        readFromFcs: Option[Boolean]
                 |    )
                 |  end In
                 |end GetClient
                 |""".stripMargin
    val r    = ScalaMerge.merge(code, spec)
    assertEquals(r.removable, Seq("GetClient.In.dummy"))
    assert(r.text.contains("    def dummy: Seq[String]\n"), r.text)
    assert(!r.without.contains("dummy"), r.without)
    assert(r.without.contains("    def readFromFcs: Option[Boolean]\n    def label: String = readFromFcs.toString\n"), r.without)

  test("a declared field: a function type or a comment with = is no value - a value outside a comment is"):
    val code = """object GetClient:
                 |  enum In:
                 |    def onDone: String => Unit
                 |    def kind: Option[String] // e.g. x = 1
                 |    def label: String = "a = b"
                 |    def same(a: Int): Boolean =
                 |      a == 1
                 |
                 |    case Standard(
                 |        kind: Option[String]
                 |    )
                 |  end In
                 |end GetClient
                 |""".stripMargin
    val spec = """object GetClient:
                 |  enum In:
                 |    case Standard(
                 |        kind: Option[String]
                 |    )
                 |  end In
                 |end GetClient
                 |""".stripMargin
    assertEquals(ScalaMerge.merge(code, spec).removable, Seq("GetClient.In.onDone", "GetClient.In.kind"))

  test("overloaded defs: each with the one of the spec in its order; end X and a multi-line annotation stay with their part"):
    val code = """object Codec:
                 |  def of(x: Int): String = x.toString
                 |  def of(x: Long): String = x.toString
                 |
                 |  @description(
                 |    "For one client"
                 |  )
                 |  case class Legacy(
                 |      id: Long
                 |  ):
                 |    def short = id
                 |  end Legacy
                 |
                 |  def own: Int = 1
                 |end Codec
                 |""".stripMargin
    val spec = """object Codec:
                 |  def of(x: Int): String = s"int $x"
                 |  def of(x: Long): String = s"long $x"
                 |end Codec
                 |""".stripMargin
    val r    = ScalaMerge.merge(code, spec)
    assert(r.text.contains("  def of(x: Int): String = s\"int $x\"\n  def of(x: Long): String = s\"long $x\"\n"), r.text)
    assertEquals(r.removable, Seq("Codec.Legacy"))
    assertEquals(
      r.without,
      """object Codec:
        |  def of(x: Int): String = s"int $x"
        |  def of(x: Long): String = s"long $x"
        |
        |  def own: Int = 1
        |end Codec
        |""".stripMargin
    )

  test("a file Orch Spec does not give: its classes go - an extension or a top-level def of its own stays"):
    val code = """package acme
                 |
                 |import acme.schema.*
                 |
                 |/** gone */
                 |case class Old(x: Int)
                 |
                 |object Old:
                 |  lazy val example = Old(1)
                 |
                 |extension (o: Old)
                 |  def y: Int = o.x
                 |
                 |def twice(x: Int): Int = 2 * x
                 |""".stripMargin
    val r    = ScalaMerge.orphaned(code)
    assertEquals(r.names, Seq("Old"))
    assertEquals(r.rest, Some("package acme\n\nimport acme.schema.*\n\nextension (o: Old)\n  def y: Int = o.x\n\ndef twice(x: Int): Int = 2 * x\n"))
    // only classes: the file goes
    assertEquals(ScalaMerge.orphaned("package acme\n\nimport acme.schema.*\n\n// a class\ncase class Old(x: Int)\n").rest, None)

  test("properties: a file merged with itself stays as it is; what is left without the removable has nothing removable"):
    for (c, sp) <- Seq(code -> spec, enumCode -> enumSpec, spec -> spec) do
      assertEquals(ScalaMerge.merge(c, c).text, c)
      assertEquals(ScalaMerge.merge(c, c).removable, Seq.empty)
      val r = ScalaMerge.merge(c, sp)
      assertEquals(ScalaMerge.merge(r.without, sp).removable, Seq.empty)
      assertEquals(ScalaMerge.merge(r.text, sp).text, r.text)

  test("a ??? in a string of the spec is no placeholder; an export is a part of its own"):
    val code = """object Texts:
                 |  val hint: String = "old"
                 |  export Other.*
                 |  def own: Int = 1
                 |end Texts
                 |""".stripMargin
    val spec = """object Texts:
                 |  val hint: String = "what ???"
                 |end Texts
                 |""".stripMargin
    val r    = ScalaMerge.merge(code, spec)
    assert(r.text.contains("  val hint: String = \"what ???\"\n  export Other.*\n  def own: Int = 1\n"), r.text)
    assertEquals(r.removable, Seq.empty)

  test("the question whether what only the code has goes: it names the files - y, yes, j, ja are a yes; anything else and no answer a no"):
    import orchescala.helper.dev.update.MergeReport
    val plan  = MergePlan("demo", Seq(
      PlannedFile("a/Old.scala", Owner.generated, Action.unchanged, removal = Some(Removal(Seq("Old"), None))),
      PlannedFile("a/In.scala", Owner.generated, Action.merged, removal = Some(Removal(Seq("In.Legacy", "In.dummy"), Some("x"))))
    ))
    var asked = Seq.empty[String]
    def answer(as: Option[String]*) =
      val left = Iterator(as*)
      asked = Seq.empty
      MergeReport.askRemoval(plan, q => { asked :+= q; if left.hasNext then left.next() else None })
    val all = Set("a/Old.scala", "a/In.scala")
    for a <- Seq("y", "yes", "J", " ja ") do assertEquals(answer(Some(a)), all, a)
    for a <- Seq("n", "", "no", "later") do assertEquals(answer(Some(a)), Set.empty[String], a)
    assertEquals(answer(None), Set.empty[String])
    assert(asked.head.contains("the file a/Old.scala (Old)") && asked.head.contains("In.Legacy, In.dummy in a/In.scala"), asked)
    assert(asked.head.contains("Delete these 3 class(es), object(s) and case(s) only the code has, 1 of the 2 file(s) as a whole? [y = all / e = each / N = none]"), asked)
    // each on its own: the one with a yes
    assertEquals(answer(Some("e"), Some("n"), Some("y")), Set("a/In.scala"))
    assertEquals(asked.tail, Seq("Delete the file a/Old.scala (Old)? [y/N] ", "Delete In.Legacy, In.dummy in a/In.scala? [y/N] "))
    // one file: yes or no
    val one = MergePlan("demo", plan.files.take(1))
    assertEquals(MergeReport.askRemoval(one, q => { asked = Seq(q); Some("e") }), Set.empty[String])
    assert(asked.head.endsWith("[y/N] "), asked)
    assertEquals(MergeReport.askRemoval(MergePlan("demo", Seq.empty), _ => fail("asked without a removal")), Set.empty[String])

  test("the report: a binary file is not diffed as text"):
    import orchescala.helper.dev.update.MergeReport
    val project = os.temp.dir()
    try
      os.write(project / "logo.png", Array[Byte](-119, 80, 78, 71, 0, 1, 2, 3))
      val neu     = java.util.Base64.getEncoder.encodeToString(Array[Byte](-119, 80, 78, 71, 9, 9))
      val plan    = MergePlan("demo", Seq(PlannedFile("logo.png", Owner.spec, Action.update, content = Some(neu), binary = true)))
      val out     = new java.io.ByteArrayOutputStream()
      Console.withOut(out)(MergeReport.printPlan(plan, project))
      val printed = out.toString.replaceAll("\u001b\\[[0-9;]*m", "")
      assert(printed.contains("a binary file - its changes are not shown"), printed)
      assert(!printed.contains(neu) && !printed.contains("PNG"), printed)
      assertEquals(MergeReport.before(project, plan), Map.empty)
    finally os.remove.all(project)

  test("an annotation with parentheses in its text: the member behind it on its line, matched with the spec's"):
    val code = """object Client:
                 |  @description("Name (optional)") def name: String = "old"
                 |  def own: Int = 1
                 |end Client
                 |""".stripMargin
    val spec = """object Client:
                 |  @description("Name (optional)") def name: String = "new"
                 |end Client
                 |""".stripMargin
    val r    = ScalaMerge.merge(code, spec)
    assertEquals(r.text, code.replace("\"old\"", "\"new\""))
    assertEquals(r.removable, Seq.empty)

  test("a multi-line string or block comment: a line in it that looks like a definition is none"):
    val code = "object Texts:\n  val help: String = \"\"\"\n  case Legacy\n  def fake: Int\n  \"\"\".stripMargin\n  /* old:\n  case Gone\n  */\n  def own: Int = 1\nend Texts\n"
    val spec = "object Texts:\n  val help: String = \"\"\"\n  case Legacy\n  def fake: Int\n  \"\"\".stripMargin\nend Texts\n"
    val r    = ScalaMerge.merge(code, spec)
    assertEquals(r.removable, Seq.empty)
    assertEquals(r.text, code)
    assertEquals(r.without, code)

  test("the summary after the merge: each file in its group, what stays only in the code kept - the END line with the numbers"):
    import orchescala.helper.dev.update.MergeReport
    val plan    = MergePlan("demo", Seq(
      PlannedFile("a/New.scala", Owner.generated, Action.create, content = Some("x")),
      PlannedFile("a/In.scala", Owner.generated, Action.merged, content = Some("y"), removal = Some(Removal(Seq("In.Legacy"), Some("z")))),
      PlannedFile("a/Old.scala", Owner.generated, Action.unchanged, removal = Some(Removal(Seq("Old"), None))),
      PlannedFile("a/Same.scala", Owner.generated, Action.unchanged)
    ))
    val result  = MergeResult(Seq("a/New.scala", "a/In.scala"), Seq("a/Old.scala"), Seq.empty, Seq("Old"))
    val out     = new java.io.ByteArrayOutputStream()
    Console.withOut(out)(MergeReport.printMerged(plan, result, os.temp.dir()))
    val printed = out.toString.replaceAll("\u001b\\[[0-9;]*m", "")
    for line <- Seq(
        "Created (1):\n- a/New.scala", "Merged (1):\n- a/In.scala", "Removed - only in the code (1):\n- the file a/Old.scala (Old)",
        "Only in the code - kept (1):\n- In.Legacy in a/In.scala", "Unchanged (1):\n- a/Same.scala",
        "END Merge from Orch Spec - demo: 1 created · 1 merged · 1 removed · 1 kept · 1 unchanged"
      )
    do assert(printed.contains(line), s"$line\n---\n$printed")

  test("the report: each change with the line of the code and two lines around it - near ones in one block"):
    import orchescala.helper.dev.update.MergeReport
    val code    = (1 to 12).map(i => s"  line$i").mkString("\n")
    val neu     = code.replace("line3", "line3 changed").replace("  line11", "    line11")
    val plain   = MergeReport.changes(code, neu).map(_.replaceAll("\u001b\\[[0-9;]*m", ""))
    assertEquals(
      plain,
      Seq(
        "    line 3:",
        "        line1",
        "        line2",
        "    -   line3",
        "    +   line3 changed",
        "        line4",
        "        line5",
        "    line 11:",
        "        line9",
        "        line10",
        "    ~     line11",
        "        line12"
      )
    )

end ScalaMergeTest
