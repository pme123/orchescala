package orchescala.helper.openApi

case class ServiceClassesGenerator()(using
    val apiDefinition: ApiDefinition,
    val config: OpenApiConfig
) extends GeneratorHelper:

  lazy val generate: Unit =
    os.makeDir.all(bpmnPath / "schema")
    apiDefinition
      .serviceClasses
      .map:
        generateSchema
      .foreach:
        case key -> content =>
          os.write.over(bpmnPath / "schema" / s"$key.scala", content)
  // println(content)
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
              val params = e.cases
                .collect:
                  case c: BpmnClass =>
                    c.fields
                .flatten
              generateEnum(e) + generateObject(classOrEnum.className, Some(params), intent = "") + generateEnumExample(e, intent = "  ")
            case c: BpmnClass =>
              generateCaseClass(c) + generateObject(classOrEnum.className, Some(c.fields)) + generateCaseClassExample(c, intent = "  ")
            case a: BpmnArray => s"type ${a.className} = Seq[${a.arrayClassName}]"
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
          .map:
            printField(_, enumName.getOrElse(bpmnClass.className), s"  $intent")
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
            case bpmnEnum: BpmnEnum   =>
              generateEnum(bpmnEnum, s"  $intent")
            case bpmnClass: BpmnClass =>
              generateCaseClass(bpmnClass, Some(key), s"  $intent")
            case enumCase: EnumCase   =>
              s"""$intent  ${printDescr(enumCase)}
                 |$intent  case ${enumCase.className}""".stripMargin
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
            case bpmnE: BpmnEnum      =>
              generateEnumExample(bpmnE, bpmnE.name, s"  $intent")
            case bpmnClass: BpmnClass =>
              generateCaseClassExample(bpmnClass, s"  $intent", bpmnEnum.className)
            case enumCase: EnumCase   =>
              s"""$intent  lazy val ${enumCase.name} = ${bpmnEnum.name}.${enumCase.name}"""
          .mkString("\n")
      }
       |${intent}end $exampleName
       |""".stripMargin

  private def generateCaseClassExample(bpmnClass: BpmnClass, intent: String, exampleName: String = "example") = {
    s"""${intent}lazy val $exampleName = ${bpmnClass.className}(
    |${
      bpmnClass.fields
        .map: field =>
          s"$intent  ${field.name} = ${printFieldValue(field)},"
        .mkString("\n")
    }
    |${intent})
    |
    |${intent}lazy val ${exampleName}Minimal = $exampleName.copy(
    |${
        bpmnClass.fields
          .map:
            printMinimalFieldValue(_)
          .mkString("\n")
      }
    |${intent})
    |""".stripMargin
  }
end ServiceClassesGenerator
