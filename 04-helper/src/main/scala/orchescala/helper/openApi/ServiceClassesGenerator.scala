package orchescala.helper.openApi

case class ServiceClassesGenerator()(using
                                     val apiDefinition: ApiDefinition,
                                     val config: OpenApiConfig
) extends GeneratorHelper:

  lazy val generate: Unit =
    os.makeDir.all(bpmnPath / "schema")
    apiDefinition
      .serviceClasses
      .map(generateSchema)
      .foreach { case key -> content =>
        os.write.over(bpmnPath / "schema" / s"$key.scala", content)
      }
  end generate

  private def generateSchema(
                              classOrEnum: IsFieldType
                            ): (String, String) =
    classOrEnum.className ->
      s"""package ${bpmnPackageSplitted._1}
         |package ${bpmnPackageSplitted._2}.schema
         |
         |${printDescr(classOrEnum)}
         |${
        classOrEnum match
          case e: BpmnEnum  =>
            val params = e.cases.collect { case c: BpmnClass => c.fields }.flatten
            generateEnum(e) +
              generateObject(classOrEnum.className, Some(params), intent = "") +
              generateEnumExample(e, intent = "  ")
          case c: BpmnClass =>
            generateCaseClass(c) +
              generateObject(classOrEnum.className, Some(c.fields)) +
              generateCaseClassExample(c, intent = "  ")
          case a: BpmnArray =>
            s"type ${a.className} = Seq[${a.arrayClassName}]"
      }
         |""".stripMargin

  private def generateCaseClass(
                                 bpmnClass: BpmnClass,
                                 enumName: Option[String] = None,
                                 intent: String = ""
                               ) =
    val key = bpmnClass.className
    s"""${intent}case${enumName.map(_ => "").getOrElse(" class")} $key(
       |${
      bpmnClass.fields
        .map(printField(_, enumName.getOrElse(bpmnClass.className), s"  $intent"))
        .mkString
    }
       |$intent)
       |""".stripMargin
  end generateCaseClass

  private def generateEnum(bpmnEnum: BpmnEnum, intent: String = ""): String =
    val key = bpmnEnum.className
    s"""$intent${printDescr(bpmnEnum)}
       |${intent}enum $key:
       |${
      bpmnEnum.cases
        .map:
          case e: BpmnEnum   => generateEnum(e, s"  $intent")
          case c: BpmnClass  => generateCaseClass(c, Some(key), s"  $intent")
          case ec: EnumCase  =>
            s"""$intent  ${printDescr(ec)}
               |$intent  case ${ec.className}""".stripMargin
        .mkString
    }
       |${intent}end $key
       |""".stripMargin
  end generateEnum

  private def generateEnumExample(
                                   bpmnEnum: BpmnEnum,
                                   exampleName: String = "example",
                                   intent: String = "    "
                                 ): String =
    s"""
       |${intent}object $exampleName:
       |${
      bpmnEnum.cases
        .map:
          case e: BpmnEnum   => generateEnumExample(e, e.name, s"  $intent")
          case c: BpmnClass  => generateCaseClassExample(c, s"  $intent", bpmnEnum.className)
          case ec: EnumCase  =>
            s"""$intent  lazy val ${ec.name} = ${bpmnEnum.name}.${ec.name}"""
        .mkString("\n")
    }
       |${intent}end $exampleName
       |""".stripMargin


  private def primitiveMinimalValue(scalaTpe: String): Option[String] =
    scalaTpe match
      case "Int"        => Some("0")
      case "Long"       => Some("0L")
      case "Double"     => Some("0.0")
      case "Float"      => Some("0.0f")
      case "Short"      => Some("0")
      case "Byte"       => Some("0")
      case "Boolean"    => Some("false")
      case "String"     => Some("\"\"")
      case "BigDecimal" => Some("new java.math.BigDecimal(0)")
      case _            => None

  private def minimalValueFor(field: ConstrField): String =
    field.wrapperType match
      case Some(WrapperType.Seq) => "Seq.empty"
      case Some(WrapperType.Set) => "Set.empty"
      case _ =>
        // type by name among service classes
        apiDefinition.serviceClasses.find(_.name == field.tpeName) match
          case Some(_: BpmnClass) =>
            s"${field.tpeName}.exampleMinimal"
          case Some(_: BpmnArray) =>
            "Seq.empty"
          case Some(_: BpmnEnum)  =>
            // Use default enum (your printFieldValue already picks the first/default)
            printFieldValue(field)
          case None =>
            primitiveMinimalValue(field.tpeName).getOrElse {
              // Fallback: normal example value
              printFieldValue(field)
            }

  private def minimalFieldLine(field: ConstrField, intent: String = "    "): String =
    // Reuse your existing helper for Options/collections:
    val optOrCollectionLine = printMinimalFieldValue(field, intent)
    if optOrCollectionLine.nonEmpty then optOrCollectionLine
    else s"$intent${field.name} = ${minimalValueFor(field)},"

  private def generateCaseClassExample(
                                        bpmnClass: BpmnClass,
                                        intent: String,
                                        exampleName: String = "example"
                                      ) =
    val exampleAssignments =
      bpmnClass.fields
        .map(f => s"$intent  ${f.name} = ${printFieldValue(f)},")
        .mkString("\n")

    val minimalAssignments =
      bpmnClass.fields
        .map(f => minimalFieldLine(f, intent + "  "))
        .mkString("\n")

    s"""${intent}lazy val $exampleName = ${bpmnClass.className}(
       |$exampleAssignments
       |$intent)
       |
       |${intent}lazy val ${exampleName}Minimal = ${bpmnClass.className}(
       |$minimalAssignments
       |$intent)
       |""".stripMargin
  end generateCaseClassExample
end ServiceClassesGenerator
