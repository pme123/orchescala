package orchescala.dmntester.server.runner

import com.typesafe.config.*
import orchescala.dmntester.HandledTesterException.ConfigException
import orchescala.dmntester.TesterValue.*
import orchescala.dmntester.*
import zio.{IO, ZIO}

import java.io.File
import scala.jdk.CollectionConverters.*
import scala.util.control.NonFatal

/** Reads / writes the `*.conf` files that hold the [[DmnConfig]]s. */
object DmnConfigHandler:

  def read(configPath: Seq[String]): IO[ConfigException, DmnConfig] =
    read(osPath(configPath.toList).toIO)

  def read(file: File): IO[ConfigException, DmnConfig] =
    ZIO
      .attempt(ConfigFactory.parseFile(file).resolve())
      .mapError: ex =>
        ConfigException(s"Could not read '${file.getAbsolutePath}': ${ex.getMessage}")
      .flatMap: config =>
        ZIO
          .fromEither(hocon.parse(config))
          .mapError: msg =>
            ConfigException(s"'${file.getAbsolutePath}' is not a valid DmnConfig: $msg")

  def write(dmnConfig: DmnConfig, path: List[String]): IO[ConfigException, Unit] =
    for
      configFile <- configFile(dmnConfig, path)
      _ <- printLine(s"Config Path write: $configFile")
      _ <- ZIO
        .attempt(
          os.write.over(configFile, hocon.render(dmnConfig), createFolders = true)
        )
        .mapError: ex =>
          ConfigException(
            s"Could not write Config '${dmnConfig.decisionId}'\n${ex.getClass.getName}: ${ex.getMessage}"
          )
    yield ()

  def delete(dmnConfig: DmnConfig, path: List[String]): IO[ConfigException, Unit] =
    for
      configFile <- configFile(dmnConfig, path)
      _ <- printLine(s"Config Path to delete: $configFile")
      _ <- ZIO
        .attempt(os.remove(configFile))
        .mapError: ex =>
          ConfigException(
            s"Could not delete Config '${dmnConfig.decisionId}': ${ex.getMessage}"
          )
    yield ()

  private def configFile(dmnConfig: DmnConfig, path: List[String]) =
    ZIO
      .attempt(osPath(path) / dmnConfig.dmnConfigPathStr)
      .mapError(ex => ConfigException(ex.getMessage))
end DmnConfigHandler

/** HOCON <-> [[DmnConfig]].
  *
  * The format is the one of the existing `*.conf` files - values may be given
  * as HOCON string, number, boolean or null; a string is interpreted with
  * [[TesterValue.fromString]], so `"12"` becomes a `NumberValue`, an ISO date
  * time a `DateValue` and `_NULL_` the `NullValue`.
  */
object hocon:

  def parse(config: Config): Either[String, DmnConfig] =
    try
      Right(
        DmnConfig(
          decisionId = config.getString("decisionId"),
          data =
            if config.hasPath("data") then testerData(config.getConfig("data"))
            else TesterData(),
          // either the single path or the named ones - see `render`
          dmnPath =
            if config.hasPath("dmnPath") then config.getString("dmnPath") else "",
          dmnPaths =
            if config.hasPath("dmnPaths") then
              config
                .getObject("dmnPaths")
                .asScala
                .map((name, value) => name -> value.unwrapped().toString)
                .toMap
            else Map.empty,
          isActive = boolean(config, "isActive", default = false),
          testUnit = boolean(config, "testUnit", default = true),
          acceptMissingRules =
            boolean(config, "acceptMissingRules", default = false)
        )
      )
    catch
      case NonFatal(ex) => Left(s"${ex.getClass.getSimpleName}: ${ex.getMessage}")

  def parse(configString: String): Either[String, DmnConfig] =
    try parse(ConfigFactory.parseString(configString).resolve())
    catch
      case NonFatal(ex) => Left(s"${ex.getClass.getSimpleName}: ${ex.getMessage}")

  def render(dmnConfig: DmnConfig): String =
    // a path is written exactly once: either the single `dmnPath` or the
    // named `dmnPaths` - never both
    val paths: Seq[(String, Object)] =
      if dmnConfig.dmnPaths.nonEmpty then
        Seq(
          "dmnPaths" -> map(
            dmnConfig.dmnPaths.toSeq
              .sortBy(_._1)
              .map((name, path) => name -> (path: Object))*
          )
        )
      else Seq("dmnPath" -> (dmnConfig.dmnPath: Object))
    ConfigValueFactory
      .fromMap(
        map(
          Seq("decisionId" -> (dmnConfig.decisionId: Object)) ++
            paths ++
            Seq(
          "isActive" -> Boolean.box(dmnConfig.isActive),
          "testUnit" -> Boolean.box(dmnConfig.testUnit),
          "acceptMissingRules" -> Boolean.box(dmnConfig.acceptMissingRules),
          "data" -> dataMap(dmnConfig.data)
            )*
        )
      )
      .render(
        ConfigRenderOptions
          .defaults()
          .setOriginComments(false)
          .setComments(false)
          .setJson(false)
      )

  // --- read ---------------------------------------------------------------

  private def testerData(config: Config): TesterData =
    TesterData(
      inputs = configs(config, "inputs").map(testerInput),
      variables = configs(config, "variables").map(testerInput),
      testCases = configs(config, "testCases").map(testCase)
    )

  private def testerInput(config: Config): TesterInput =
    TesterInput(
      key = config.getString("key"),
      nullValue = boolean(config, "nullValue", default = false),
      values =
        if config.hasPath("values") then
          config.getList("values").asScala.toList.map(testerValue)
        else List.empty,
      // the id is only used by the UI to keep the rows apart
      id =
        if config.hasPath("id") then config.getString("id").trim.toIntOption
        else None
    ).withId

  private def testCase(config: Config): TestCase =
    TestCase(
      inputs = valueMap(config, "inputs"),
      results = configs(config, "results").map(testResult)
    )

  private def testResult(config: Config): TestResult =
    TestResult(
      // zio-config used to write the index as String - accept both
      rowIndex = config.getString("rowIndex").trim.toInt,
      outputs = valueMap(config, "outputs")
    )

  private def valueMap(config: Config, path: String): Map[String, TesterValue] =
    if !config.hasPath(path) then Map.empty
    else
      config
        .getObject(path)
        .asScala
        .map((key, value) => key -> testerValue(value))
        .toMap

  private def testerValue(value: ConfigValue): TesterValue =
    value.valueType() match
      case ConfigValueType.BOOLEAN =>
        BooleanValue(value.unwrapped().asInstanceOf[java.lang.Boolean])
      case ConfigValueType.NUMBER =>
        NumberValue(BigDecimal(value.unwrapped().toString))
      case ConfigValueType.NULL   => NullValue
      case ConfigValueType.STRING =>
        TesterValue.fromString(value.unwrapped().asInstanceOf[String])
      case other =>
        throw new IllegalArgumentException(
          s"Not expected value type: $other (${value.render()})"
        )

  private def configs(config: Config, path: String): List[Config] =
    if config.hasPath(path) then config.getConfigList(path).asScala.toList
    else List.empty

  private def boolean(config: Config, path: String, default: Boolean): Boolean =
    if config.hasPath(path) then config.getBoolean(path) else default

  // --- write --------------------------------------------------------------

  private def dataMap(data: TesterData): java.util.Map[String, Object] =
    map(
      "inputs" -> data.inputs.map(inputMap).asJava,
      "variables" -> data.variables.map(inputMap).asJava,
      "testCases" -> data.testCases.map(testCaseMap).asJava
    )

  private def inputMap(input: TesterInput): java.util.Map[String, Object] =
    map(
      "id" -> Int.box(input.withId.id.getOrElse(0)),
      "key" -> input.key,
      "nullValue" -> Boolean.box(input.nullValue),
      "values" -> input.values.map(configValue).asJava
    )

  private def testCaseMap(testCase: TestCase): java.util.Map[String, Object] =
    map(
      "inputs" -> valueMap(testCase.inputs),
      "results" -> testCase.results.map(testResultMap).asJava
    )

  private def testResultMap(testResult: TestResult): java.util.Map[String, Object] =
    map(
      "rowIndex" -> Int.box(testResult.rowIndex),
      "outputs" -> valueMap(testResult.outputs)
    )

  private def valueMap(
      values: Map[String, TesterValue]
  ): java.util.Map[String, Object] =
    values.map((key, value) => key -> configValue(value)).asJava

  private def configValue(testerValue: TesterValue): Object =
    testerValue match
      case NumberValue(value)  => value.underlying()
      case BooleanValue(value) => Boolean.box(value)
      case StringValue(value)  => value
      case v: DateValue        => v.valueStr
      case NullValue           => NullValue.constant

  private def map(entries: (String, Object)*): java.util.Map[String, Object] =
    val result = new java.util.LinkedHashMap[String, Object]()
    entries.foreach((key, value) => result.put(key, value))
    result
end hocon
