package orchescala.domain

import munit.FunSuite
import sttp.tapir.SchemaType.SProduct

/** The description of `inConfig` lives on `WithConfig` - the derived schema of an `In` must still
  * carry it, without repeating it on every `In`.
  */
class WithConfigDescriptionTest extends FunSuite:
  import WithConfigDescriptionTest.*

  test("the inConfig of an In gets its description from WithConfig"):
    val schema = summon[ApiSchema[In]]
    val field  = schema.schemaType match
      case p: SProduct[?] => p.fields.find(_.name.name == "inConfig")
      case other          => fail(s"no product: $other")
    assertEquals(
      field.flatMap(_.schema.description),
      Some("A way to override process configuration.\n\n**SHOULD NOT BE USED on Production!**")
    )
end WithConfigDescriptionTest

object WithConfigDescriptionTest:
  case class InConfig(timer: String = "PT1M")
  object InConfig:
    given ApiSchema[InConfig]  = deriveApiSchema
    given InOutCodec[InConfig] = deriveInOutCodec

  case class In(clientKey: Long, inConfig: Option[InConfig] = None) extends WithConfig[InConfig]:
    lazy val defaultConfig = InConfig()
  object In:
    given ApiSchema[In]  = deriveApiSchema
    given InOutCodec[In] = deriveInOutCodec
end WithConfigDescriptionTest
