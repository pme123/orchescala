package orchescala
package api

import orchescala.domain.*
import orchescala.engine.DefaultEngineConfig
import sttp.apispec.openapi.circe.yaml.*
import sttp.tapir.*
import sttp.tapir.json.circe.*

class CoproductSchemaTest extends munit.FunSuite, DefaultApiCreator:

  import CoproductSchemaTest.*

  lazy val apiConfig                     = ApiConfig(DefaultEngineConfig(), "DemoConfig")
  def title                              = "Coproduct Test"
  def version                            = "1.0"
  lazy val companyProjectVersion: String = "0.1.0"
  lazy val projectDescr: String          = ""

  private lazy val yaml: String =
    removeCoproductTitles(
      openAPIDocsInterpreter
        .toOpenAPI(endpoint.post.in("rental").out(jsonBody[RentalParty]), title, version)
    ).toYaml

  // the Schema of the parent enum - everything indented below `    RentalParty:`
  private lazy val parentSchema: String =
    yaml.linesIterator
      .dropWhile(_ != "    RentalParty:")
      .drop(1)
      .takeWhile(l => l.startsWith("      ") || l.isBlank)
      .mkString("\n")

  test("the parent Schema references all cases with oneOf") {
    assert(parentSchema.contains("oneOf:"), parentSchema)
    assert(parentSchema.contains("$ref: '#/components/schemas/PrivateIndividual'"), parentSchema)
    assert(parentSchema.contains("$ref: '#/components/schemas/CompaniesAndOther'"), parentSchema)
    assert(
      parentSchema.contains("$ref: '#/components/schemas/SeveralPrivateIndividuals'"),
      parentSchema
    )
  }

  test("the parent Schema has the same discriminator as the circe Codec") {
    assert(
      parentSchema.contains("$ref: '#/components/schemas/PrivateIndividual'"),
      parentSchema
    )
    assert(!parentSchema.contains("title:"), parentSchema)
  }

  test("the parent Schema has NO title - so Redoc labels the oneOf with the case titles") {
    assert(parentSchema.nonEmpty, yaml)
    assert(!parentSchema.contains("title:"), s"RentalParty must have no title:\n$parentSchema")
  }

  test("the cases keep their title") {
    assert(yaml.contains("title: PrivateIndividual"), yaml)
    assert(yaml.contains("title: CompaniesAndOther"), yaml)
    assert(yaml.contains("title: SeveralPrivateIndividuals"), yaml)
  }

  test("the discriminator values match the ones of the circe Codec") {
    import io.circe.syntax.*
    val json = (RentalParty.PrivateIndividual("Peter", "Pan"): RentalParty).asJson
    assertEquals(json.hcursor.get[String]("type"), Right("PrivateIndividual"))
  }

end CoproductSchemaTest

object CoproductSchemaTest:

  // The cases MUST be PascalCase - lowercase names are dropped by Tapir as package segments,
  // so that all variants would collapse to the parent name `RentalParty`.
  enum RentalParty:
    case PrivateIndividual(firstName: String, lastName: String)
    case CompaniesAndOther(companyName: String)
    case SeveralPrivateIndividuals(count: Int)

  object RentalParty:
    given InOutCodec[RentalParty] = deriveInOutCodec
    given ApiSchema[RentalParty]  = deriveApiSchema
  end RentalParty

end CoproductSchemaTest
