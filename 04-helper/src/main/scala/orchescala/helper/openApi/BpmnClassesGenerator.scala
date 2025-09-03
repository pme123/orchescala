package orchescala.helper.openApi

case class BpmnClassesGenerator()(using
    val apiDefinition: ApiDefinition,
    val config: OpenApiConfig
) extends GeneratorHelper:

  lazy val generate =
    apiDefinition.bpmnClasses
      .map:
        generateModel
      .foreach:
        case key -> content =>
          os.write.over(bpmnPath / s"$key.scala", content)
  end generate

  private lazy val arrayAliasesByName: Map[String, BpmnArray] =
    apiDefinition.serviceClasses.collect { case a: BpmnArray => a.name -> a }.toMap

  private def findArrayAlias(name: String): Option[BpmnArray] =
    arrayAliasesByName.get(name)

  private def outFieldArrayAlias(field: ConstrField): Option[(String, String)] =
    findArrayAlias(field.tpeName).map(alias => alias.name -> alias.arrayClassName)

  private def typedNone(renderedType: String): String =
    val t = renderedType.trim
    if t.startsWith("Option[") then s"None: $t" else "None"

  private def printInOut(field: Option[ConstrField], serviceObj: BpmnServiceObject): String =
    field.map(printField(_, serviceObj.className, "    ")).mkString("", "", "  ")

  private def printInOutExample(field: Option[ConstrField]): String =
    field.map(f => s"      ${f.name} = ${printFieldValue(f)}").mkString("")

  private def inExampleArgs(so: BpmnServiceObject): String =
    so.inputParams.toSeq.flatten
      .map(f => s"      ${f.name} = ${printFieldValue(f)},")
      .mkString("\n")

  private def minimalParamsList(so: BpmnServiceObject, pad: String = "      "): String =
    (so.inputParams.toSeq.flatten ++ so.in.toSeq)
      .map(printMinimalFieldValue(_, pad))
      .mkString("\n")

  private def serviceOutExampleRef(so: BpmnServiceObject): String =
    so.out match
      case Some(outField) => s"Out.example.${outField.name}"
      case None           => "NoOutput()"

  private def serviceOutExampleMinimal(so: BpmnServiceObject): String =
    so.out match
      case Some(outField) => typedNone(printFieldType(outField))
      case None           => "NoOutput()"

  private def generateModel(serviceObj: BpmnServiceObject) =
    val name           = serviceObj.className
    val topicName      = s"${config.projectTopicName}${superClass.versionTag}"
    val superVersioned = config.superClassName(superClass.versionTag).getOrElse(superClass.name)
    val extendsClause  = s"$superVersioned"

    val serviceInType  = serviceObj.in.map(printFieldType(_)).getOrElse("NoInput")
    val serviceOutType = serviceObj.out.map(printFieldType(_)).getOrElse("NoOutput")

    val content =
      s"""package ${bpmnPackageSplitted._1}
         |package ${bpmnPackageSplitted._2}
         |
         |import io.circe.Encoder
         |import $bpmnPackage.schema.*
         |
         |object $name
         |    extends $extendsClause:
         |
         |  final val topicName = "$topicName.${serviceObj.topicName}"
         |
         |  val descr = ${printDescrTextOpt(serviceObj).getOrElse("-")}
         |  val path  = "${serviceObj.method}: ${serviceObj.path}"
         |
         |  type ServiceIn  = $serviceInType
         |  type ServiceOut = $serviceOutType
         |
         |  object ServiceIn:
         |    lazy val example        = ${serviceObj.in.map(_ => "In.example").getOrElse(
          "NoInput()"
        )}
         |    lazy val exampleMinimal = ${serviceObj.in.map(_ => "In.exampleMinimal").getOrElse(
          "example"
        )}
         |  end ServiceIn
         |
         |  object ServiceOut:
         |    lazy val example                                 = ${serviceOutExampleRef(serviceObj)}
         |    lazy val exampleMinimal                          = ${serviceOutExampleMinimal(
          serviceObj
        )}
         |    lazy val mock: MockedServiceResponse[ServiceOut] =
         |      MockedServiceResponse.success${serviceObj.mockStatus}(example)
         |    lazy val mockMinimal                             =
         |      MockedServiceResponse.success${serviceObj.mockStatus}(exampleMinimal)
         |  end ServiceOut
         |
         |${if serviceObj.in.nonEmpty then printIn(serviceObj) else "  type In = NoInput"}
         |
         |${if serviceObj.out.nonEmpty then printOut(serviceObj) else "  type Out = NoOutput"}
         |
         |  lazy val example =
         |    serviceTask(
         |      in = ${serviceObj.in.map(_ => "In.example").getOrElse("NoInput()")},
         |      out = ${serviceObj.out.map(_ => "Out.example").getOrElse("NoOutput()")},
         |      ServiceOut.mock,
         |      ServiceIn.example
         |    )
         |
         |  lazy val exampleMinimal =
         |    serviceTask(
         |      in = ${serviceObj.in.map(_ => "In.exampleMinimal").getOrElse("NoInput()")},
         |      out = ${serviceObj.out.map(_ => "Out.exampleMinimal").getOrElse("NoOutput()")},
         |      ServiceOut.mockMinimal,
         |      ServiceIn.exampleMinimal
         |    )
         |
         |end $name
         |""".stripMargin
    serviceObj.className -> content
  end generateModel

  private def printIn(serviceObj: BpmnServiceObject) =
    val caseClass =
      s"""  case class In(
         |${
          serviceObj.inputParams.toSeq.flatten.map(printField(_, "In", "    ")).mkString
        }${printInOut(serviceObj.in, serviceObj)}
         |  )
         |""".stripMargin

    val companion =
      s"""  object In:
         |    given ApiSchema[In]  = deriveApiSchema
         |    given InOutCodec[In] = deriveInOutCodec
         |
         |    lazy val example = In(
         |${inExampleArgs(serviceObj)}
         |${printInOutExample(serviceObj.in)}
         |    )
         |
         |    lazy val exampleMinimal = ${
          if serviceObj.in.nonEmpty || serviceObj.inputParams.exists(_.nonEmpty) then
            s"""example.copy(
               |${minimalParamsList(serviceObj)}
               |    )""".stripMargin
          else "example"
        }
         |  end In
         |""".stripMargin

    caseClass + "\n" + companion
  end printIn

  private def printOut(serviceObj: BpmnServiceObject) =
    val caseClass =
      s"""  case class Out(
         |${printInOut(serviceObj.out, serviceObj)}
         |  )
         |""".stripMargin

    val encoderLines: String =
      serviceObj.out.flatMap(outFieldArrayAlias) match
        case Some((aliasName, elemClass)) =>
          s"""    // Explicit encoders for alias $aliasName = Seq[$elemClass]
             |    given Encoder[$aliasName] = Encoder.encodeSeq[$elemClass]
             |    given Encoder[Option[$aliasName]] = Encoder.encodeOption[Seq[$elemClass]]
             |""".stripMargin
        case None                         => ""

    val companion =
      s"""  object Out:
         |    given ApiSchema[Out]  = deriveApiSchema
         |    given InOutCodec[Out] = deriveInOutCodec
         |$encoderLines
         |    lazy val example = ${
          serviceObj.out match
            case Some(_) =>
              s"""Out(
                 |${printInOutExample(serviceObj.out)}
                 |    )""".stripMargin
            case None    => "NoOutput()"
        }
         |
         |    lazy val exampleMinimal = ${
          serviceObj.out match
            case Some(outF) =>
              s"""Out(
                 |${printMinimalFieldValue(outF, "      ")}
                 |    )""".stripMargin
            case None       => "NoOutput()"
        }
         |  end Out
         |""".stripMargin

    caseClass + "\n" + companion
  end printOut

end BpmnClassesGenerator
