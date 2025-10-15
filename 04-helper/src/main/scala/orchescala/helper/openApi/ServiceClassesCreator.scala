package orchescala.helper.openApi

import io.swagger.v3.oas.models.media.Schema

import scala.jdk.CollectionConverters.*

case class ServiceClassesCreator(
    allSchemas: Map[String, Schema[?]]
)(
    using val config: OpenApiConfig
) extends CreatorHelper:

  lazy val create: Seq[IsFieldType] =
    schemas
      .map:
        case k -> sch => createSchema(k, sch)
      .toSeq
  end create

  private def createSchema(
      key: String,
      schema: Schema[?]
  ): IsFieldType =
    println(s"createSchema $key")
    if schema.getAllOf == null
    then {
      if schema.getType != null && schema.getType.toLowerCase == "array" then
        createArray(key, schema)
      else
        createCaseClass(key, schema)
    } else createEnum(key, schema)

  private def createCaseClass(
      key: String,
      schema: Schema[?]
  ) =
    BpmnClass(
      key,
      Option(schema.getDescription),
      createProperties(schema.getProperties, schema.getRequired)
    )

  private def createArray(
      key: String,
      schema: Schema[?]
  ) =
    BpmnArray(
      key,
      Option(schema.getDescription),
      schema.extractType(schema.getItems.get$ref())
    )

  private def createEnum(key: String, schema: Schema[?]): BpmnEnum =
    println(s"createEnum $key")
    BpmnEnum(
      key,
      Option(schema.getDescription),
      schema.getAllOf.asScala
        .zipWithIndex
        .map:
          case sch -> _ if sch.get$ref != null =>
            val refTypeName = sch.refType
            val refSchema = findRefSchema(refTypeName)
            refSchema.map:
              case sch if sch.getAllOf == null =>
                createCaseClass(refTypeName, sch)
              case sch => createEnum(refTypeName, sch)
            .getOrElse(BpmnEnumCase("SHOULD NOT HAPPEN", descr = None))
          case sch -> index =>
            createCaseClass(s"Default$index", sch)
        .toSeq
    )

  private def findRefSchema(refTypeName: String): Option[Schema[?]] =
    schemas.find:
      case k -> _ =>
        refTypeName == k
    .map:
      case _ -> refSch =>
        refSch

  private def createProperties(
      properties: java.util.Map[String, Schema[?]],
      required: java.util.List[String]
  ): Seq[ConstrField] =
    Option(properties)
      .map: props =>
        props.asScala.toSeq.map:
          case key -> schema =>
            val schm =
              allSchemas
                .find:
                  case k -> _ =>
                    k == key
                .map:
                  case _ -> sch =>
                    sch
              .getOrElse(schema)

            schm.createField(
              Some(key),
              optIsRequired = Option(required).map(_.asScala.toSeq.contains(key))
            )
      .toSeq
      .flatten
  private lazy val schemas = allSchemas
    .filter:
      case key -> schema =>
        schema.getAllOf != null ||
        schema.getType == "array" ||
        schema.getType == "object" ||
        schema.getTypes != null && schema.getTypes.asScala.contains("object")

end ServiceClassesCreator
