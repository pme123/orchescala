package orchescala.simulation

import orchescala.domain.*
import orchescala.domain.CamundaVariable.*
import orchescala.simulation.TestOverrideType.*
import zio.ZIO

object ResultChecker:

  def checkProps(
      withOverrides: WithTestOverrides[?],
      result: Seq[JsonProperty]
  ): ResultType = {
    val scenarioData =
      withOverrides.testOverrides match
        case Some(TestOverrides(overrides)) =>
          checkO(overrides, result, summon[ScenarioData])
        case _                              =>
          checkP(withOverrides.camundaToCheckMap, result, summon[ScenarioData])
      end match
    if scenarioData.hasErrors then
      ZIO.fail(SimulationError.ProcessError(scenarioData))
    else
      ZIO.succeed(scenarioData)
  }
  end checkProps

  private def checkO(
      overrides: Seq[TestOverride],
      result: Seq[JsonProperty],
      scenarioData: ScenarioData
  ): ScenarioData =
    overrides
      .foldLeft(scenarioData): (scenarioData, testOverride) =>
        testOverride match
          case TestOverride(Some(k), Exists, _)             =>
            checkExistsInResult(result, k, scenarioData)
          case TestOverride(Some(k), NotExists, _)          =>
            checkExistsNotInResult(result, k, scenarioData)
          case TestOverride(Some(k), IsEquals, Some(v))     =>
            checkIsEqualValue(k, v, result, scenarioData)
          case TestOverride(Some(k), HasSize, Some(value))  =>
            checkHasSize(k, value.toJson, result, scenarioData)
          case TestOverride(Some(k), Contains, Some(value)) =>
            checkContains(k, value.toJson, result, scenarioData)
          case _                                            =>
            scenarioData.error(
              s"Only ${TestOverrideType.values.mkString(", ")} for TestOverrides supported."
            )

  private def checkP[T <: Product](
      expected: Map[String, CamundaVariable],
      result: Seq[JsonProperty],
      scenarioData: ScenarioData
  ): ScenarioData =
    expected
      .foldLeft(scenarioData):
        case (scenarioData, key -> CNull) =>
          result
            .find: p =>
              p.key == key && (!p.value.isNull)
            // it is only ok, if the value is null
            .map: p =>
              scenarioData.error(
                s"The variable '$key' (value: '${p.value}') exists in the result - but is NOT expected."
              )
            .getOrElse(scenarioData) // it is ok if not in the result

        case (scenarioData, key -> expectedValue) =>
          result
            .find(_.key == key)
            .map:
              case JsonProperty(key, resultJson) =>
                checkJson(expectedValue.toJson, resultJson, key, scenarioData)
            .getOrElse:
              scenarioData.error(
                s"$key does NOT exist in the result variables."
              )
  end checkP

  private def checkExistsInResult(
      result: Seq[JsonProperty],
      key: String,
      scenarioData: ScenarioData
  ): ScenarioData =
    if !checkExistsInResult(result, key) then
      scenarioData.error(s"$key does NOT exist in the result variables.")
    else
      scenarioData
  end checkExistsInResult

  private def checkExistsInResult(
      result: Seq[JsonProperty],
      key: String
  ): Boolean =
    result.exists(_.key == key)
  end checkExistsInResult

  private def checkExistsNotInResult(
      result: Seq[JsonProperty],
      key: String,
      scenarioData: ScenarioData
  ): ScenarioData =
    if checkExistsInResult(result, key) then
      scenarioData.error(s"$key does NOT exist in the result variables.")
    else
      scenarioData
  end checkExistsNotInResult

  private def checkIsEqualValue(
      key: String,
      expectedValue: CamundaVariable,
      result: Seq[JsonProperty],
      scenarioData: ScenarioData
  ): ScenarioData =
    if checkExistsInResult(result, key) then
      val json = result.find(_.key == key).map(_.value)
      if json.contains(expectedValue.toJson) then
        scenarioData
      else
        val sd = scenarioData.error(
          s"""The value of $key is different:
             | - expected: ${expectedValue}
             | - result  : ${json.mkString}""".stripMargin
        )
        checkMultiLines(expectedValue.toJson, json.get, sd)
      end if
    else
      scenarioData.error(s"$key does NOT exist.")

  private def checkMultiLines(expectedValue: Json, resultValue: Json, scData: ScenarioData) =
    if expectedValue.isString && resultValue.isString then
      if expectedValue.asString.get.contains("\n") then // compare each line for complex strings
        val result   = resultValue.asString.get.split("\n")
        val expected = expectedValue.asString.get.split("\n")
        result.zip(expected).foldLeft(scData):
          case (sd, (r, e)) =>
            if r != e then
              sd.error(
                s""">>> Bad Line:
                   | - expected: '$e'
                   | - result  : '$r'""".stripMargin
              )
            else sd
      else scData
    else scData

  private def checkHasSize(
      key: String,
      expectedSize: Json,
      result: Seq[JsonProperty],
      scenarioData: ScenarioData
  ): ScenarioData =
    if checkExistsInResult(result, key) then
      val json = result.find(_.key == key).map(_.value)
      json match
        case Some(r) if r.isArray && expectedSize.asNumber.get.toInt.contains(r.asArray.get.size) =>
          scenarioData
        case _                                                                                    =>
          scenarioData.error(
            s"""Size of $key is different:
               | - expected: ${expectedSize.asNumber.get.toInt}
               | - result  : ${
                json.get.asArray.get.size
              }""".stripMargin
          )
      end match
    else
      scenarioData.error(s"$key NOT exist in the result variables.")

  private def checkContains(
      key: String,
      expectedValue: Json,
      result: Seq[JsonProperty],
      scenarioData: ScenarioData
  ): ScenarioData =
    val json = result.find(_.key == key).map(_.value)
    json match
      case Some(r) if r.isArray =>
        if r.asArray.get.contains(expectedValue) then
          scenarioData
        else
          scenarioData.error(s"$key does NOT contains $expectedValue in $r")
      case Some(r)              =>
        scenarioData.error(s"$key is NOT an array in the result variables.")
      case None                 =>
        scenarioData.error(s"$key does NOT exist in the result variables.")
    end match
  end checkContains

  private def checkJson(
      expectedJson: io.circe.Json,
      resultJson: io.circe.Json,
      key: String,
      scenarioData: ScenarioData
  ): ScenarioData =
    def compareJsons(
        expJson: io.circe.Json,
        resJson: io.circe.Json,
        path: String,
        scenarioData: ScenarioData
    ): ScenarioData =
      if expJson != resJson then
        (expJson, resJson) match
          case _ if expJson == resJson                   =>
            scenarioData
          case _ if expJson.isArray && resJson.isArray   =>
            val expJsonArray = expJson.asArray.toList.flatten
            val resJsonArray = resJson.asArray.toList.flatten
            if expJsonArray.size != resJsonArray.size then
              scenarioData.error(
                s"""Size of array '$key' is different:
                   | - expected: ${expJsonArray.size}
                   | - result  : ${resJsonArray.size}""".stripMargin
              )
            else
              expJsonArray.foldLeft(scenarioData): (sd, expJson) =>
                resJsonArray.find(_.deepDropNullValues == expJson.deepDropNullValues) match
                  case Some(_) => sd
                  case None    =>
                    sd.error(
                      s"""Value for $key not found in array:
                         | - expected: $expJson
                         | - result  : $resJsonArray""".stripMargin
                    )
            end if
          case _ if expJson.isObject && resJson.isObject =>
            val expJsonObj = expJson.asObject.get
            val resJsonObj = resJson.asObject.get
            val expKeys    = expJsonObj.keys.toSeq
            val resKeys    = resJsonObj.keys.toSeq
            val commonKeys = expKeys.intersect(resKeys).toSet
            val uniqueKeys = (expKeys ++ resKeys).toSet.diff(commonKeys)
            val scenData   = commonKeys.foldLeft(scenarioData): (sd, key) =>
              compareJsons(
                expJsonObj(key).get,
                resJsonObj(key).get,
                s"$path.$key",
                sd
              )
            val diffs      = uniqueKeys.foldLeft(Seq.empty[String]): (ds, key) =>
              expJsonObj(key)
                .map: json =>
                  ds :+
                    s" - $path.$key: ${json.noSpaces} (expected field not in result)"
                .orElse:
                  resJsonObj(key).map: json =>
                    ds :+
                      s" - $path.$key: ${json.noSpaces} (field in result not expected)"
                .getOrElse(ds)
            if diffs.nonEmpty then
              scenData.error(diffs.mkString("\n"))
            else scenData
          case _                                         =>
            scenarioData.error(
              s"$key: ${expJson.noSpaces} (expected) != ${resJson.noSpaces} (result)\n -> Path: ${if path.isEmpty then "." else path}"
            )
      else scenarioData

    compareJsons(expectedJson.deepDropNullValues, resultJson.deepDropNullValues, "", scenarioData)

  end checkJson

end ResultChecker
