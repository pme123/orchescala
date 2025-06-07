package orchescala
package simulation2

import orchescala.domain.*
import orchescala.domain.CamundaVariable.*

import scala.reflect.ClassTag

case class TestOverride(
    key: Option[String],
    overrideType: TestOverrideType,
    value: Option[Json] = None
)

case class TestOverrides(overrides: Seq[TestOverride]): // Seq[TestOverride])

  def :+(testOverride: TestOverride): TestOverrides = TestOverrides(
    overrides :+ testOverride
  )
end TestOverrides

enum TestOverrideType:
  case Exists, NotExists, IsEquals, HasSize, Contains

object TestOverrideType:
  given InOutCodec[TestOverrideType] = deriveCodec
  given ApiSchema[TestOverrideType]  = deriveApiSchema

def addOverride[
    T <: Product
](
    model: T,
    key: Option[String],
    overrideType: TestOverrideType,
    value: Option[Json] = None
): TestOverrides =
  val testOverride                    = TestOverride(key, overrideType, value)
  val newOverrides: Seq[TestOverride] = model match
    case TestOverrides(overrides) =>
      overrides :+ testOverride
    case _                        =>
      Seq(testOverride)
  TestOverrides(newOverrides)
end addOverride

object TestOverrides:
  given InOutCodec[TestOverrides] = deriveInOutCodec

object TestOverride:
  given InOutCodec[TestOverride] = deriveInOutCodec

trait TestOverrideExtensions:

  extension [T <: WithTestOverrides[T]](withOverride: T)

    def exists(
        key: String
    ): T =
      add(Some(key), TestOverrideType.Exists)

    def notExists(
        key: String
    ): T =
      add(Some(key), TestOverrideType.NotExists)

    def isEquals(
        key: String,
        value: Json
    ): T =
      add(
        Some(key),
        TestOverrideType.IsEquals,
        Some(value)
      )
    // used for collections
    def hasSize(
        key: String,
        size: Int
    ): T =
      add(
        Some(key),
        TestOverrideType.HasSize,
        Some(size.asJson)
      )

    // used for DMNs ResultList and CollectEntries
    def hasSize(
        size: Int
    ): T =
      add(
        None,
        TestOverrideType.HasSize,
        Some(size.asJson)
      )

    // used for collections
    def contains(
        key: String,
        value: Json
    ): T =
      add(
        Some(key),
        TestOverrideType.Contains,
        Some(value)
      )

    // used for DMNs ResultList and CollectEntries
    def contains[V: InOutEncoder](
        expected: V
    ): T =
      add(
        None,
        TestOverrideType.Contains,
        Some(expected.asJson.deepDropNullValues)
      )

    private def add(
        key: Option[String],
        overrideType: TestOverrideType,
        value: Option[Json] = None
    ): T =
      withOverride.add(TestOverride(key, overrideType, value))
        .asInstanceOf[T]

    private def camundaVariable[V: InOutEncoder](
        value: V
    ) =
      val v = value match
        case _: scala.reflect.Enum => value
        case _: (Seq[?] | Product) => value.asJson
        case _                     => value
      Some(CamundaVariable.valueToCamunda(v))
    end camundaVariable
  end extension
end TestOverrideExtensions
