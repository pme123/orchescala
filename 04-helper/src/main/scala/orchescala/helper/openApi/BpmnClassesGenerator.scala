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

  private def printInOut(field: Option[ConstrField], serviceObj: BpmnServiceObject): String =
    field.map(printField(_, serviceObj.className, "    ")).mkString("", "", "  ")

  private def generateModel(serviceObj: BpmnServiceObject) =
    val name                                             = serviceObj.className
    val topicName                                        = s"${config.projectTopicName}${superClass.versionTag}"
    val printInOutExample: Option[ConstrField] => String =
      _.map(f => s"    ${f.name} = ${printFieldValue(f)}").mkString("", "", "  ")
    val content                                          =
      s"""package ${bpmnPackageSplitted._1}
         |package ${bpmnPackageSplitted._2} 
         |
         |import $bpmnPackage.schema.*
         |
         |object $name
         |  extends ${config.superClassName(superClass.versionTag).getOrElse(superClass.name)}:
         |
         |  final val topicName = "$topicName.${serviceObj.topicName}"
         |
         |  val descr = ${printDescrTextOpt(serviceObj).getOrElse("-")}
         |  val path = "${serviceObj.method}: ${serviceObj.path}"
         |  
         |  type ServiceIn = ${serviceObj.in.map(printFieldType(_)).getOrElse("NoInput")}
         |  type ServiceOut = ${serviceObj.out.map(printFieldType(_)).getOrElse("NoOutput")}
         |  lazy val serviceInExample = ${serviceObj.in.map(printFieldValue(_)).map(_.replace(
          "Some(",
          "Option("
        )).getOrElse(
          "    NoInput()"
        )}
         |  lazy val serviceMock = MockedServiceResponse.success${serviceObj.mockStatus}${
          serviceObj.out
            .map:
              printFieldValue(_)
            .map(v => s"(${v.replace("Some(", "Option(")})").getOrElse("")
        }
         |  lazy val serviceMinimalMock = MockedServiceResponse.success${
          serviceObj.mockStatus
        }${
          serviceObj.out
            .map:
              printFieldValue(_)
            .map: v =>
              s"(${
                  v.replaceAll("Some(.*)", "None")
                    .replaceAll("Seq\\(.*\\)", "Seq.empty")
                    .replaceAll("Set\\(.*\\)", "Set.empty")
                })"
            .getOrElse("")
        }
         |  lazy val serviceInMinimalExample = serviceInExample
        ${serviceObj.in
          .map: in =>
            s"    .copy(${printMinimalFieldValue(in)})"
          .getOrElse:
            ""
        }
      }
         |
         |${if serviceObj.in.nonEmpty then printIn(serviceObj) else "  type In = NoInput"}
         |${if serviceObj.out.nonEmpty then printOut(serviceObj) else "  type Out = NoOutput"}
         |
         |  lazy val inExample = ${
          if serviceObj.in.nonEmpty then
            s"  In(\n${
                serviceObj.inputParams
                  .toSeq.flatten
                  .map: field =>
                    s"    ${field.name} = ${printFieldValue(field)},"
                  .mkString("\n")
              }\n${printInOutExample(serviceObj.in)}\n  )"
          else "NoInput()"
        }
         |  lazy val inMinimalExample = inExample${
          if serviceObj.in.nonEmpty then
            s".copy(${
                (serviceObj.inputParams.toSeq.flatten ++ serviceObj.in.toSeq)
                  .map:
                    printMinimalFieldValue(_, "    ")
                  .mkString("\n")
              }\n  )"
          else ""
        }
         |  lazy val outExample = ${
          if serviceObj.out.nonEmpty then s"Out(\n${printInOutExample(serviceObj.out)}\n  )"
          else "NoOutput()"
        }
         |  
         |  lazy val outMinimalExample = outExample${
          if serviceObj.in.nonEmpty then
            s".copy(\n${
                serviceObj.out
                  .map:
                    printMinimalFieldValue(_)
                  .getOrElse("")
              }\n  )"
          else ""
        }
         |
         |  lazy val example =
         |    serviceTask(
         |      in = inExample,
         |      out = outExample,
         |      serviceMock,
         |      serviceInExample
         |    )
         |  lazy val minimalExample =
         |    serviceTask(
         |      in = inMinimalExample,
         |      out = outMinimalExample,
         |      serviceMinimalMock,
         |      serviceInMinimalExample
         |    )
         |end $name
         |""".stripMargin
    serviceObj.className -> content
  end generateModel

  private def printIn(serviceObj: BpmnServiceObject) =
    s"""  case class In(
       |  ${
        serviceObj
          .inputParams
          .toSeq
          .flatten
          .map:
            printField(_, "In", "    ")
          .mkString
      }${printInOut(serviceObj.in, serviceObj)}
       |  )
       |${generateObject("In", serviceObj.inputParams, "  ")}
       |""".stripMargin

  private def printOut(serviceObj: BpmnServiceObject) =
    s"""  case class Out(
       |${printInOut(serviceObj.out, serviceObj)}
       |  )
       |${generateObject("Out", None, "  ")}""".stripMargin
end BpmnClassesGenerator
