package orchescala.api.templates

import orchescala.domain.*
import orchescala.api.*
import io.circe.syntax.*
import orchescala.domain.InputParams.*

/**
 * Camunda 7 implementation of the ModelerTemplateGenerator interface
 */
class C7TemplateGenerator(
    config: ModelerTemplateConfig,
    val projectName: String,
    val companyName: String,
    apiVersion: String
) extends ModelerTemplateGenerator:

  private val helper = TemplateGeneratorHelper(config, projectName, companyName, apiVersion)
  
  val version: Int = helper.version

  def generate(apis: List[InOutApi[?, ?]]): Unit =
    helper.ensureTemplateDirectory()
    println(s"Generate C7 Modeler Templates for: $projectName: ${apis.map(_.id).mkString(", ")}")
    
    apis.foreach: api =>
      val supported = helper.isApiSupported(api)
      helper.logApiGeneration(api, "C7", supported)
      
      if supported then
        api match
          case extApi: ExternalTaskApi[?, ?] => generateExternalTaskTemplate(extApi)
          case procApi: ProcessApi[?, ?, ?]  => generateProcessTemplate(procApi)
          case _                             => // Already logged as unsupported

  private def generateExternalTaskTemplate(api: ExternalTaskApi[?, ?]): Unit =
    val vars = getVariablesForApi(api)
    generateTemplate(
      api.inOut,
      AppliesTo.activity,
      ElementType.serviceTask,
      Seq(
        TemplProp.serviceTaskTopic(api.id),
        TemplProp.serviceTaskType
      ) ++ generateGeneralVariables(isCallActivity = false, vars, api)
    )

  private def generateProcessTemplate(api: ProcessApi[?, ?, ?]): Unit =
    generateTemplate(
      api.inOut,
      AppliesTo.activity,
      ElementType.callActivity,
      Seq(
        TemplProp.calledElement(api.id)
      ) ++ generateGeneralVariables(
        isCallActivity = true,
        processVariables,
        api
      ) :+ TemplProp.businessKey
    )

  private def generateTemplate(
      inOut: InOut[?, ?, ?],
      appliesTo: Seq[AppliesTo],
      elementType: ElementType,
      properties: Seq[TemplProp]
  ): Unit =
    val mapProps = generateMappings(
      inOut.inVariables,
      if elementType == ElementType.callActivity then PropType.`camunda:in`
      else PropType.`camunda:inputParameter`
    ) ++
      generateMappings(
        inOut.outVariables,
        if elementType == ElementType.callActivity then PropType.`camunda:out`
        else PropType.`camunda:outputParameter`
      )
    
    val niceName = helper.generateNiceName(inOut)
    val template = MTemplate(
      inOut.id,
      inOut.id,
      helper.extractDescription(inOut),
      version,
      appliesTo,
      elementType,
      mapProps ++ properties :+ TemplProp.name(niceName),
      config.schemaC7
    )
    
    os.write.over(
      config.templatePath / s"${inOut.id}.json",
      template.asJson.deepDropNullValues.toString
    )

  private def generateMappings(
      variables: Seq[(String, Any)],
      propType: PropType
  ): Seq[TemplProp] =
    variables
      .filterNot:
        case name -> _ => name == "inConfig" // don't show configuration
      .map:
        case name -> value =>
          TemplProp(
            label = name,
            
            value = if PropType.`camunda:inputParameter` == propType then
              mapping(name, value)
            else name,
            binding = propType match
              case PropType.`camunda:in`              => PropBinding.`camunda:in`(
                  `type` = propType,
                  target = name
                )
              case PropType.`camunda:out`             => PropBinding.`camunda:out`(
                  `type` = propType,
                  source = name
                )
              case PropType.`camunda:inputParameter`  => PropBinding.`camunda:inputParameter`(
                  `type` = propType,
                  name = name
                )
              case PropType.`camunda:outputParameter` => PropBinding.`camunda:outputParameter`(
                  `type` = propType,
                  source = mapping(name, value)
                )
              case _                                  =>
                throw new IllegalArgumentException(s"PropType not expected for mappings: $propType")
          )


  private def generateGeneralVariables(
      isCallActivity: Boolean,
      vars: Seq[InputParamForTempl],
      inOutApi: InOutApi[?, ?]
  ): Seq[TemplProp] =
    if config.generateGeneralVariables then
      vars.map: in =>
        val k = in.inParam.toString
        TemplProp(
          label = k,
          value = if isCallActivity then k else in.defaultValue(inOutApi.inOut.out),
          binding = if isCallActivity then
            PropBinding.`camunda:in`(target = k)
          else
            PropBinding.`camunda:inputParameter`(name = k)
        )
    else
      Seq.empty

  /**
   * Gets the appropriate variables for the given API type
   */
  private def getVariablesForApi(api: InOutApi[?, ?]): Seq[InputParamForTempl] = api match
    case _: ServiceWorkerApi[?, ?, ?, ?] => serviceWorkerVariables
    case _: ExternalTaskApi[?, ?] => customWorkerVariables
    case _ => Seq.empty

  private def serviceWorkerVariables: Seq[InputParamForTempl] =
    optionalMapping(outputServiceMock) +: customWorkerVariables

  private def customWorkerVariables: Seq[InputParamForTempl] = Seq(
    InputParamForTempl(manualOutMapping, "#{true}"),
    InputParamForTempl(outputVariables, _.productElementNames.mkString(", ")),
    optionalMapping(outputMock),
    InputParamForTempl(handledErrors, "handledError1, handledError2"),
    InputParamForTempl(regexHandledErrors, "errorRegex1, errorRegex2")
  )

  private def processVariables: Seq[InputParamForTempl] = Seq(
    optionalMapping(servicesMocked),
    optionalMapping(mockedWorkers),
    optionalMapping(outputMock),
    optionalMapping(impersonateUserId),
    optionalMapping(identityCorrelation)
  )

  private def optionalMapping(name: InputParams): InputParamForTempl =
    InputParamForTempl(name, optionalMapping(name.toString))

  def optionalMapping(name: String): String =
    s"#{execution.getVariable('$name')}"

  def mapping(name: String, elem: Any): String =
    elem match
      case _: Option[?] => optionalMapping(name)
      case _ => s"#{$name}"

end C7TemplateGenerator
