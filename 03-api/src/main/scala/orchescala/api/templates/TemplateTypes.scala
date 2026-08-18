package orchescala.api.templates

import orchescala.domain.*
import orchescala.api.*

sealed trait MTemplateType:
  def name: String
  def id: String
  def description: String
  def version: Int
  def appliesTo: Seq[AppliesTo]
  def elementType: ElementType
  def $schema: String
  def groups: Seq[PropGroup]
  def entriesVisible: Boolean

object MTemplateType:
  given InOutCodec[MTemplateType] = deriveInOutCodec("$schema")
  given ApiSchema[MTemplateType]  = deriveApiSchema
  

// Template Models
final case class MTemplate(
    name: String,
    id: String,
    description: String,
    version: Int,
    appliesTo: Seq[AppliesTo],
    elementType: ElementType,
    properties: Seq[TemplProp],
    $schema: String,
    groups: Seq[PropGroup] = Seq.empty,
    entriesVisible: Boolean = true
) extends MTemplateType

object MTemplate:
  given InOutCodec[MTemplate] = deriveInOutCodec
  given ApiSchema[MTemplate]  = deriveApiSchema

final case class MTemplateC8(
    name: String,
    id: String,
    description: String,
    version: Int,
    appliesTo: Seq[AppliesTo],
    elementType: ElementType,
    properties: Seq[TemplPropC8],
    $schema: String,
    groups: Seq[PropGroup] = Seq.empty,
    entriesVisible: Boolean = true,
    engines : Map[String, String] = Map("camunda" -> "^8.6")
) extends MTemplateType

object MTemplateC8:
  given InOutCodec[MTemplateC8] = deriveInOutCodec
  given ApiSchema[MTemplateC8]  = deriveApiSchema

// Element Types
final case class ElementType(
    value: AppliesTo
)

object ElementType:
  lazy val callActivity: ElementType = ElementType(AppliesTo.`bpmn:CallActivity`)
  lazy val serviceTask: ElementType  = ElementType(AppliesTo.`bpmn:ServiceTask`)

  given InOutCodec[ElementType] = deriveInOutCodec
  given ApiSchema[ElementType]  = deriveApiSchema
end ElementType

// Template Properties for C7
final case class TemplProp(
    value: String,
    binding: PropBinding,
    label: String = "",
    description: String = "",
    group: Option[PropGroupId] = None,
    `type`: TemplType = TemplType.Hidden
)

object TemplProp:
  lazy val businessKey                = TemplProp(
    value = "#{execution.processBusinessKey}",
    binding = PropBinding.`camunda:in:businessKey`()
  )
  def name(value: String)             = TemplProp(
    value = value,
    binding = PropBinding.property(name = "name")
  )
  def calledElement(value: String)    = TemplProp(
    value = value,
    binding = PropBinding.property(name = "calledElement")
  )
  def serviceTaskTopic(value: String) = TemplProp(
    value = value,
    binding = PropBinding.property(name = "camunda:topic")
  )
  lazy val serviceTaskType            = TemplProp(
    value = "external",
    binding = PropBinding.property(name = "camunda:type")
  )

  given InOutCodec[TemplProp] = deriveInOutCodec
  given ApiSchema[TemplProp]  = deriveApiSchema
end TemplProp

// Template Properties for C8
final case class TemplPropC8(
    value: String,
    binding: PropBindingC8,
    label: String = "",
    description: String = "",
    group: Option[PropGroupId] = None,
    `type`: TemplType = TemplType.Hidden,
)

object TemplPropC8:
  def name(value: String)             = TemplPropC8(
    value = value,
    binding = PropBindingC8.property(name = "name")
  )
  def serviceTaskTopic(value: String) = TemplPropC8(
    value = value,
    binding = PropBindingC8.`zeebe:taskDefinition`()
  )
  def serviceTaskRetries(retries: Int = 0) = TemplPropC8(
    value = retries.toString,
    binding = PropBindingC8.`zeebe:taskDefinition`(property = "retries")
  )

  given InOutCodec[TemplPropC8] = deriveInOutCodec
  given ApiSchema[TemplPropC8]  = deriveApiSchema
end TemplPropC8

// Property Bindings for C7
enum PropBinding:
  case property(
      `type`: PropType = PropType.property,
      name: String
  )
  case `camunda:in:businessKey`(
      `type`: PropType = PropType.`camunda:in:businessKey`
  )
  case `camunda:in`(
      `type`: PropType = PropType.`camunda:in`,
      target: String,
      expression: Boolean = false
  )
  case `camunda:out`(
      `type`: PropType = PropType.`camunda:out`,
      source: String,
      expression: Boolean = false
  )
  case `camunda:inputParameter`(
      `type`: PropType = PropType.`camunda:inputParameter`,
      name: String
  )
  case `camunda:outputParameter`(
      `type`: PropType = PropType.`camunda:outputParameter`,
      source: String
  )
end PropBinding

object PropBinding:
  given InOutCodec[PropBinding] = deriveInOutCodec
  given ApiSchema[PropBinding]  = deriveApiSchema

// Property Bindings for C8
enum PropBindingC8:
  case property(
      `type`: PropTypeC8 = PropTypeC8.property,
      name: String
  )
  case `zeebe:input`(
      `type`: PropTypeC8 = PropTypeC8.`zeebe:input`,
      name: String
  )
  case `zeebe:output`(
      `type`: PropTypeC8 = PropTypeC8.`zeebe:output`,
      source: String
  )
  case `zeebe:taskHeader`(
      `type`: PropTypeC8 = PropTypeC8.`zeebe:taskHeader`,
      name: String
  )
  case `zeebe:taskDefinition`(
      `type`: PropTypeC8 = PropTypeC8.`zeebe:taskDefinition`,
      property: String = "type"
                             )
  case `zeebe:property`(
      `type`: PropTypeC8 = PropTypeC8.`zeebe:property`,
      name: String
  )
end PropBindingC8

object PropBindingC8:
  given InOutCodec[PropBindingC8] = deriveInOutCodec
  given ApiSchema[PropBindingC8]  = deriveApiSchema

// Property Groups
final case class PropGroup(
    id: PropGroupId,
    label: String
)

object PropGroup:
  val callActivity = PropGroup(
    PropGroupId.calledProcess,
    "Called Process"
  )
  val inMappings   = PropGroup(
    PropGroupId.inMappings,
    "In Mappings"
  )
  val outMapping   = PropGroup(
    PropGroupId.outMappings,
    "Out Mappings"
  )
  val inputs       = PropGroup(
    PropGroupId.inputs,
    "Inputs"
  )
  val outputs      = PropGroup(
    PropGroupId.outputs,
    "Outputs"
  )

  given InOutCodec[PropGroup] = deriveInOutCodec
  given ApiSchema[PropGroup]  = deriveApiSchema
end PropGroup

// Enums
enum TemplType:
  case String, Text, Boolean, Dropdown, Hidden
object TemplType:
  given InOutCodec[TemplType] = deriveEnumInOutCodec
  given ApiSchema[TemplType]  = deriveApiSchema

enum PropType:
  case property, `camunda:in:businessKey`, `camunda:in`, `camunda:out`, `camunda:inputParameter`,
    `camunda:outputParameter`
object PropType:
  given InOutCodec[PropType] = deriveEnumInOutCodec
  given ApiSchema[PropType]  = deriveApiSchema

enum PropTypeC8:
  case property, `zeebe:input`, `zeebe:output`, `zeebe:taskHeader`, `zeebe:taskDefinition`, `zeebe:property`
object PropTypeC8:
  given InOutCodec[PropTypeC8] = deriveEnumInOutCodec
  given ApiSchema[PropTypeC8]  = deriveApiSchema

enum PropGroupId:
  case calledProcess, inMappings, outMappings, inputs, outputs
object PropGroupId:
  given InOutCodec[PropGroupId] = deriveEnumInOutCodec
  given ApiSchema[PropGroupId]  = deriveApiSchema

enum AppliesTo:
  case `bpmn:Activity`, `bpmn:CallActivity`, `bpmn:ServiceTask`

object AppliesTo:
  lazy val activity     = Seq(AppliesTo.`bpmn:Activity`) // all
  lazy val callActivity = Seq(AppliesTo.`bpmn:CallActivity`)
  lazy val serviceTask  = Seq(AppliesTo.`bpmn:ServiceTask`)

  given InOutCodec[AppliesTo] = deriveEnumInOutCodec
  given ApiSchema[AppliesTo]  = deriveApiSchema
end AppliesTo

// Helper types for template generation
case class InputParamForTempl(
    inParam: InputParams,
    // for the default value, you have:
    //  - a simple value
    //  - a mapping function out => ...
    defaultValue: (InOut[?, ?, ?]) => String
)

object InputParamForTempl:
  def apply(name: InputParams, inputMapValue: String): InputParamForTempl =
    new InputParamForTempl(name, _ => inputMapValue)

  def apply(name: InputParams, inputMapFunct: (InOut[?, ?, ?]) => String): InputParamForTempl =
    new InputParamForTempl(name, inputMapFunct)
end InputParamForTempl

