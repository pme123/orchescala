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

end ScalaMergeTest
