package orchescala
package api

import orchescala.domain.*
import orchescala.engine.DefaultEngineConfig
import sttp.apispec.openapi.circe.yaml.*
import sttp.tapir.*
import sttp.tapir.json.circe.*

/** Tapir alone marks every collection field as optional - `Seq[A]` and `Option[Seq[A]]` would be
  * indistinguishable in the OpenAPI. deriveApiSchema marks the plain `Seq[A]` as required.
  */
class SeqRequiredSchemaTest extends munit.FunSuite, DefaultApiCreator:

  import SeqRequiredSchemaTest.*

  lazy val apiConfig                     = ApiConfig(DefaultEngineConfig(), "DemoConfig")
  def title                              = "Seq Required Test"
  def version                            = "1.0"
  lazy val companyProjectVersion: String = "0.1.0"
  lazy val projectDescr: String          = ""

  private lazy val yaml: String =
    openAPIDocsInterpreter
      .toOpenAPI(endpoint.post.in("out").out(jsonBody[Out]), title, version)
      .toYaml

  // the `required:` list of one component schema
  private def requiredOf(schema: String): Seq[String] =
    yaml.linesIterator
      .dropWhile(_ != s"    $schema:")
      .drop(1)
      .takeWhile(l => l.startsWith("      ") || l.isBlank)
      .dropWhile(_.trim != "required:")
      .drop(1)
      .takeWhile(_.trim.startsWith("- "))
      .map(_.trim.drop(2))
      .toSeq

  test("a plain Seq field is required") {
    assert(requiredOf("SeqRequiredSchemaTest.Out").contains("items"), yaml)
  }

  test("an Option[Seq] field is NOT required") {
    assert(!requiredOf("SeqRequiredSchemaTest.Out").contains("maybeItems"), yaml)
  }

  // the type decides, not the initialisation: a default (`= Seq.empty`, as in InitIn) only
  // initialises process variables - the field is still a Seq
  test("a Seq field with a @default annotation is required as well") {
    assert(requiredOf("SeqRequiredSchemaTest.Out").contains("defaultItems"), yaml)
  }

  test("a Seq field with a plain Scala default value is required as well") {
    assert(requiredOf("SeqRequiredSchemaTest.Out").contains("plainDefaultItems"), yaml)
  }

  test("a required Seq is still an array, an Option[Seq] as well") {
    assert(yaml.contains("items:"), yaml)
    assert(!yaml.contains("nullable"), yaml)
  }

  test("a nested class gets the same treatment") {
    assert(requiredOf("Nested").contains("tags"), yaml)
    assert(!requiredOf("Nested").contains("maybeTags"), yaml)
  }

  // ApiCreator.schemaName: `In` / `Out` / `InitIn` get their owner as prefix, other classes not
  test("In / Out Schemas are named with their owner, other classes with the short name only") {
    assert(yaml.contains("    SeqRequiredSchemaTest.Out:"), yaml)
    assert(yaml.contains("$ref: '#/components/schemas/SeqRequiredSchemaTest.Out'"), yaml)
    assert(yaml.contains("    Nested:"), yaml)
    assert(!yaml.contains("SeqRequiredSchemaTest.Nested"), yaml)
  }

end SeqRequiredSchemaTest

object SeqRequiredSchemaTest:

  // Tapir does not derive nested classes inline - every class needs its own ApiSchema
  case class Nested(tags: Seq[String], maybeTags: Option[Seq[String]])
  object Nested:
    given InOutCodec[Nested] = deriveInOutCodec
    given ApiSchema[Nested]  = deriveApiSchema
  end Nested

  case class Out(
      items: Seq[String],
      maybeItems: Option[Seq[String]],
      @Schema.annotations.default(Seq.empty[String])
      defaultItems: Seq[String] = Seq.empty,
      plainDefaultItems: Seq[String] = Seq.empty,
      nested: Nested
  )

  object Out:
    given InOutCodec[Out] = deriveInOutCodec
    given ApiSchema[Out]  = deriveApiSchema
  end Out

end SeqRequiredSchemaTest
