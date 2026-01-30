package orchescala.api.templates

import orchescala.domain.*
import orchescala.api.*
import io.circe.syntax.*
import orchescala.domain.InputParams.*

/** Camunda 8 implementation of the ModelerTemplateGenerator interface
  */
class C8TemplateGenerator(
    config: ModelerTemplateConfig,
    val projectName: String,
    val companyName: String,
    apiVersion: String
) extends ModelerTemplateGenerator:

  private val helper = TemplateGeneratorHelper(config, projectName, companyName, apiVersion)

  val version: Int = helper.version

  def generate(apis: List[InOutApi[?, ?]]): Unit                             =
    os.makeDir.all(config.templatePath)
    println(s"Generate C8 Modeler Templates for: $projectName: ${apis.map(_.id).mkString(", ")}")

    apis.foreach: api =>
      val supported = helper.isApiSupported(api)
      helper.logApiGeneration(api, "C8", supported)

      if supported then
        api match
          case extApi: ExternalTaskApi[?, ?] => generateExternalTaskTemplate(extApi)
          case procApi: ProcessApi[?, ?, ?]  => generateProcessTemplate(procApi)
          case _                             => // Already logged as unsupported
      end if
  end generate
  private def generateExternalTaskTemplate(api: ExternalTaskApi[?, ?]): Unit =
    val vars = getVariablesForApi(api)
    generateTemplate(
      api.inOut,
      AppliesTo.activity,
      ElementType.serviceTask,
      Seq(
        TemplPropC8.serviceTaskTopic(api.id),
        TemplPropC8.serviceTaskRetries()
      ) ++ generateGeneralVariables(isCallActivity = false, vars, api)
    )
  end generateExternalTaskTemplate

  private def generateProcessTemplate(api: ProcessApi[?, ?, ?]): Unit =
    generateTemplate(
      api.inOut,
      AppliesTo.activity,
      ElementType.callActivity,
      generateGeneralVariables(
        isCallActivity = true,
        processVariables,
        api
      )
    )

  private def generateTemplate(
      inOut: InOut[?, ?, ?],
      appliesTo: Seq[AppliesTo],
      elementType: ElementType,
      properties: Seq[TemplPropC8]
  ): Unit =
    val mapProps = generateMappings(
      inOut.inVariables,
      PropTypeC8.`zeebe:input`
    ) ++
      generateMappings(
        inOut.outVariables,
        PropTypeC8.`zeebe:output`
      )

    val niceName = helper.generateNiceName(inOut)
    val template = MTemplateC8(
      inOut.id,
      inOut.id,
      helper.extractDescription(inOut),
      version,
      appliesTo,
      elementType,
      mapProps ++ properties :+ TemplPropC8.name(niceName),
      config.schemaC8
    )

    os.write.over(
      config.templatePath / s"${inOut.id}.json",
      Json.arr(template.asJson).deepDropNullValues.toString
    )
  end generateTemplate

  private def generateMappings(
      variables: Seq[(String, Any)],
      propType: PropTypeC8
  ): Seq[TemplPropC8] =
    variables
      .filterNot:
        case name -> _ => name == "inConfig" // don't show configuration
      .map:
        case name -> value =>
          TemplPropC8(
            label = name,
            value = mapping(name, value),
            binding = propType match
              case PropTypeC8.property             => PropBindingC8.property(
                  `type` = propType,
                  name = name
                )
              case PropTypeC8.`zeebe:input`          => PropBindingC8.`zeebe:input`(
                  `type` = propType,
                  name = name
                )
              case PropTypeC8.`zeebe:output`         => PropBindingC8.`zeebe:output`(
                  `type` = propType,
                  source = name
                )
              case PropTypeC8.`zeebe:taskHeader`     => PropBindingC8.`zeebe:taskHeader`(
                  `type` = propType,
                  name = name
                )
              case PropTypeC8.`zeebe:taskDefinition` => PropBindingC8.`zeebe:taskDefinition`(
                  `type` = propType,
                  property = name
                )
              case PropTypeC8.`zeebe:property`       => PropBindingC8.`zeebe:property`(
                  `type` = propType,
                  name = name
                )
          )

  private def generateGeneralVariables(
      isCallActivity: Boolean,
      vars: Seq[InputParamForTempl],
      inOutApi: InOutApi[?, ?]
  ): Seq[TemplPropC8] =
    if config.generateGeneralVariables then
      vars.map: in =>
        val k = in.inParam.toString
        TemplPropC8(
          label = k,
          value = if isCallActivity then k else in.defaultValue(inOutApi.inOut),
          binding = PropBindingC8.`zeebe:input`(name = k)
        )
    else
      Seq.empty

  /** Gets the appropriate variables for the given API type
    */
  private def getVariablesForApi(api: InOutApi[?, ?]): Seq[InputParamForTempl] = api match
    case _: ServiceWorkerApi[?, ?, ?, ?] => serviceWorkerVariables
    case _: ExternalTaskApi[?, ?]        => customWorkerVariables
    case _                               => Seq.empty

  private def serviceWorkerVariables: Seq[InputParamForTempl] =
    optionalMapping(_outputServiceMock) +: customWorkerVariables

  private def customWorkerVariables: Seq[InputParamForTempl] = Seq(
    InputParamForTempl(_manualOutMapping, "true"),
    InputParamForTempl(
      _outputVariables,
      _.outVariableNames.map(n => s""""$n"""").mkString("[ ", ", ", " ]")
    ),
    optionalMapping(_outputMock),
    InputParamForTempl(_handledErrors, """["handledError1", "handledError2"]"""),
    InputParamForTempl(_regexHandledErrors, """["errorRegex1", "errorRegex2"]""")
  )

  private def processVariables: Seq[InputParamForTempl] = Seq(
    optionalMapping(_servicesMocked),
    optionalMapping(_mockedWorkers),
    optionalMapping(_outputMock),
    optionalMapping(impersonateUserId),
    optionalMapping(_identityCorrelation)
  )

  private def optionalMapping(name: InputParams): InputParamForTempl =
    InputParamForTempl(name, optionalMapping(name.toString))

  private def optionalMapping(name: String): String =
    name // to be verified

  private def mapping(name: String, elem: Any): String =
    elem match
      case _: Option[?] => optionalMapping(name)
      case _            => name
end C8TemplateGenerator
