package orchescala.helper.openApi

import io.swagger.v3.oas.models.examples.Example
import io.swagger.v3.oas.models.media.Schema

import scala.jdk.CollectionConverters.*

trait CreatorHelper:

  protected def config: OpenApiConfig

  extension (schema: Schema[?])

    protected def createField(
        optKey: Option[String] = None,
        optDescr: Option[String] = None,
        optIsRequired: Option[Boolean] = None,
        optExample: Option[AnyRef] = None,
        optExamples: Option[java.util.Map[String, Example]] = None
    ): ConstrField =
      val fromType = extractType(optKey.getOrElse("fieldKeyFromType"))
      val tpe = fromType.head.toUpper + fromType.tail
      val key = optKey.getOrElse(tpe.head.toLower + tpe.tail)
      val isOptional: Boolean =
        (Option(schema.getNullable), optIsRequired) match
          case Some(opt) -> _ => opt
          case _ -> Some(req) => !req
          case _ -> _ => true

      val wrapperType = schemaType match
        case Some("Set") => Some(WrapperType.Set)
        case Some("Seq") => Some(WrapperType.Seq)
        case _ => None

      val enumCases = Option(schema.getEnum)
        .map:
          _.asScala.toSeq
            .map:
              _.toString
      val typeWithEnum =
        enumCases
          .map: _ =>
            key.split("-").map(k =>
              k.head.toUpper + k.tail
            ).mkString // uppercase for enum metrics-name -> MetricsName
          .getOrElse:
            tpe

      val example =
        optExample
          .orElse:
            optExamples
              .flatMap:
                _.asScala
                  .map:
                    case _ -> v => Option(v.getValue)
                  .collectFirst:
                    case Some(v) =>
                      v
          .flatMap: ex =>
            parser.parse(ex.toString).toOption.map(_.asJson.deepDropNullValues)

      ConstrField(
        key,
        Option(schema.getDescription).orElse(optDescr),
        typeWithEnum,
        isOptional,
        wrapperType,
        Option(schema.getFormat),
        enumCases,
        example = example
      )
    end createField

    def extractType(key: String): String =
      schemaType match
        case Some(value) if Seq("Seq", "Set").contains(value) =>
          if schema.getItems == null then
            println(s"Items is null for $key")
            config.typeMapping("AnyType")
          else
            schema.getItems.extractType(s"$key.items")
        case Some(value) =>
          schema.getFormat match
            case "int64" => "Long"
            case "date-time" => "LocalDateTime"
            case "date" => "LocalDate"
            case _ if schema.getMaximum != null && schema.getMaximum.longValue() > Int.MaxValue =>
              "Long"
            case _ => value
        case None if schema.get$ref() != null =>
          refType
        case None =>
          println(s"Unsupported Type: $key - ${schema.get$ref()} - ${schema.getType}")
          config.typeMapping("AnyType")
    end extractType

    protected def schemaType =
      config.typeMapping.get(schema.getType)
        .orElse(
          config.typeMapping.get(
            Option(schema.getType).getOrElse:
              Option(schema.getTypes).flatMap(_.asScala.headOption).getOrElse("NOTYPEDEF")
          )
        )

    protected def refType: String =
      (for
        ref <- Option(schema.get$ref())
        tpe <- ref.split("/").lastOption
      yield config.typeMapping.getOrElse(tpe, tpe))
        .getOrElse:
          "???"

  end extension
end CreatorHelper
