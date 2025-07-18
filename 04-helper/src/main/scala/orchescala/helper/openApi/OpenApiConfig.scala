package orchescala.helper.openApi

import orchescala.api.ApiConfig
import orchescala.helper.util.ModuleConfig

case class OpenApiConfig(
    projectName: String,
    subProjectName: Option[String] = None,
    typeMappers: Seq[TypeMapper] = OpenApiConfig.generalTypeMapping,
    openApiFile: os.RelPath = OpenApiConfig.openApiFile,
    outputPath: String => os.Path = OpenApiConfig.outputPath(_),
    superBpmnClass: String = OpenApiConfig.superBpmnClass,
    superSimulationClass: String = OpenApiConfig.superSimulationClass,
    superWorkerClass: String = OpenApiConfig.superWorkerClass,
    // you can filter names from the path that you don't want in the name
    // e.g. /clients/{id}/portfolios
    // filterNames = Seq("clients", "{id}")
    // creates name: Portfolios
    filterNames: Seq[String] = Seq.empty
):
  def bpmnPath(versionTag: String): os.Path = path(ModuleConfig.domainModule, versionTag)
  def bpmnPackage(versionTag: String): String = pckg(ModuleConfig.domainModule.name, versionTag)
  def bpmnPackageSplitted(versionTag: String): (String, String) = pckgSplitted(ModuleConfig.domainModule.name, versionTag)
  def simulationPath(versionTag: String): os.Path = path(ModuleConfig.simulationModule, versionTag)
  def simulationPackage(versionTag: String): String =
    pckg(ModuleConfig.simulationModule.name, versionTag)
  def workerPath(versionTag: String): os.Path = path(ModuleConfig.workerModule, versionTag)
  def workerPackageSplitted(versionTag: String): (String, String) = pckgSplitted(ModuleConfig.workerModule.name, versionTag)
  lazy val projectTopicName: String =
    s"$projectName${subProjectName.map(n => s"-$n").getOrElse("")}"
  lazy val typeMapping =
    typeMappers
      .map:
        case TypeMapper(from, to, _) => from -> to
      .toMap
  lazy val implMapping =
    typeMappers
      .map:
        case TypeMapper(_, to, impl) => to -> impl
      .distinct
      .toMap

  def superClassName(version: String) =
    subProjectName.map(n => s"${n.head.toUpper + n.tail}$version")

  private def path(moduleConfig: ModuleConfig, versionTag: String) =
    outputPath(moduleConfig.nameWithLevel) / projectName.split(
      '-'
    ).toSeq / moduleConfig.name / subProjectName.toSeq / versionTag
  private def pckg(moduleName: String, versionTag: String): String =
    s"${projectName.replace('-', '.')}.$moduleName${subProjectName.map(n => s".$n").getOrElse("")}.$versionTag"
  private def pckgSplitted(moduleName: String, versionTag: String): (String, String) =
    s"${projectName.replace('-', '.')}.$moduleName" -> s"${subProjectName.getOrElse("")}.$versionTag"

end OpenApiConfig

object OpenApiConfig:
  lazy val openApiFile: os.RelPath = os.rel / "openApi.yml"
  lazy val outputPath: String => os.Path = os.pwd / _ / ".generated"
  lazy val superBpmnClass: String = "CompanyBpmnServiceTaskDsl"
  lazy val superSimulationClass: String = "CompanySimulation"
  lazy val superWorkerClass: String = "CompanyServiceWorkerDsl"
  lazy val generalTypeMapping = Seq(
    TypeMapper("array", "Seq", _.getOrElse("Seq.empty")),
    TypeMapper("set", "Set", _.getOrElse("Set.empty")),
    TypeMapper("boolean", "Boolean", _.getOrElse("true")),
    TypeMapper("string", "String", _.getOrElse("\"SomeDummyText\"")),
    TypeMapper("int", "Int", _.getOrElse("12")),
    TypeMapper("integer", "Int", _.getOrElse("12")),
    TypeMapper("long", "Long", _.map(ex => s"${ex}L").getOrElse("2345312311231212L")),
    TypeMapper("float", "Float", _.map(ex => s"${ex}f").getOrElse("12.5f")),
    TypeMapper("byte", "Byte", _.getOrElse("2")),
    TypeMapper("short", "Short", _.getOrElse("12")),
    TypeMapper("char", "Char", _.map(e => s"'$e'").getOrElse("'12'")),
    TypeMapper("double", "Double", _.getOrElse("14.5")),
    TypeMapper("object", "Json", jsonObj),
    TypeMapper("file", "File", file),
    TypeMapper("binary", "File", file),
    TypeMapper("number", "Double", _.getOrElse("14.5")),
    TypeMapper("decimal", "BigDecimal", ex => s"new java.math.BigDecimal(${ex.getOrElse("12.6")})"),
    TypeMapper("ByteArray", "Array[Byte]", _.getOrElse("")),
    TypeMapper("AnyType", "Json", jsonObj),
    TypeMapper(
      "date-time",
      "LocalDateTime",
      _.map(e => s"""LocalDateTime.parse($e)""").getOrElse("LocalDateTime.now()")
    ),
    TypeMapper(
      "date",
      "LocalDate",
      _.map(e => s"""LocalDate.parse($e)""").getOrElse("LocalDate.now()")
    )
  )

  lazy val jsonObj: Option[String] => String = _.map(ex =>
    s"""parser.parse(s\"\"\"$ex\"\"\").toOption.getOrElse(Json.obj())"""
  ).getOrElse("Json.obj()")

  private lazy val file: Option[String] => String =
    ex => s"new java.io.File(\"${ex.getOrElse("path/to/file")}\")"

end OpenApiConfig

case class TypeMapper(
    jsonType: String,
    scalaType: String,
    defaultValue: Option[String] => String
)
