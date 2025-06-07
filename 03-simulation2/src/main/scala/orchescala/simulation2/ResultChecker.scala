package orchescala.simulation2

import io.circe.*
import io.circe.parser.*
import orchescala.domain.*
import orchescala.domain.CamundaVariable.*
import orchescala.simulation2.TestOverrideType.*
import zio.{IO, ZIO}

import scala.collection.mutable.ListBuffer
import scala.deriving.Mirror.Sum
import scala.reflect.ClassTag

trait ResultChecker:
  def scenarioData: ScenarioData

  def checkProps(
      withOverrides: WithTestOverrides[?],
      result: Json,
      scenarioData: ScenarioData
  ): ScenarioData =
    withOverrides.testOverrides match
      case Some(TestOverrides(overrides)) =>
        checkO(overrides, result, scenarioData)
      case _                              =>
        checkP(withOverrides.inOut.outAsJson, result, scenarioData)
    end match
  end checkProps

  private def checkO(
      overrides: Seq[TestOverride],
      result: Json,
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
            checkHasSize(k, value, result, scenarioData)
          case TestOverride(Some(k), Contains, Some(value)) =>
            checkContains(k, value, result, scenarioData)
          case _                                            =>
            scenarioData.error(
              s"Only ${TestOverrideType.values.mkString(", ")} for TestOverrides supported."
            )

  /*
  // DMN
  def checkOForCollection(
      overrides: Seq[TestOverride],
      result: Seq[CamundaVariable | Map[String, CamundaVariable]]
  ): IO[SimulationError, ScenarioData] =
    overrides
      .map {
        case TestOverride(None, HasSize, Some(CInteger(size, _))) =>
          val matches = result.size == size
          if !matches then
            println(
              s"!!! Size '${result.size}' of collection is NOT equal to $size in $result"
            )
          matches
        case TestOverride(None, Contains, Some(expected))         =>
          val exp     = expected match
            case CJson(jsonStr, _) =>
              parse(jsonStr) match
                case Right(json) =>
                  CamundaVariable.jsonToCamundaValue(json)
                case Left(ex)    =>
                  throwErr(s"Problem parsing Json: $jsonStr\n$ex")
            case other             => other
          val matches = result.contains(exp)
          if !matches then
            println(
              s"!!! Result '$result' of collection does NOT contain to $expected"
            )
          matches
        case _                                                    =>
          println(
            s"!!! Only ${TestOverrideType.values.mkString(", ")} for TestOverrides supported."
          )
          false
      }
      .forall(_ == true)
   */
  private def checkP[T <: Product](
      expected: Json,
      result: Json,
      scenarioData: ScenarioData
  ): ScenarioData =
    if expected == result then
      scenarioData
    else
      scenarioData.error(
        s"The expected value does not match the result:\n${DiffPrinter.printDeepDiff(expected, result)}"
      )
  end checkP

  private def checkExistsInResult(
      result: Json,
      key: String,
      scenarioData: ScenarioData
  ): ScenarioData =
    if !checkExistsInResult(result, key) then
      scenarioData.error(s"$key did NOT exist in $result")
    else
      scenarioData
  end checkExistsInResult

  private def checkExistsInResult(
      result: Json,
      key: String
  ): Boolean =
    result.hcursor.keys.toSeq.flatten.contains(key)
  end checkExistsInResult

  private def checkExistsNotInResult(
      result: Json,
      key: String,
      scenarioData: ScenarioData
  ): ScenarioData =
    if checkExistsInResult(result, key) then
      scenarioData.error(s"$key did NOT exist in $result")
    else
      scenarioData
  end checkExistsNotInResult

  private def checkIsEqualValue(
      key: String,
      expectedValue: Json,
      result: Json,
      scenarioData: ScenarioData
  ): ScenarioData =
    if checkExistsInResult(result, key) then
      if expectedValue == result.hcursor.downField(key).focus.get then
        scenarioData
      else
        val sd = scenarioData.error(
          s"""The value of $key is different:
             | - expected: ${expectedValue}
             | - result  : ${result.hcursor.downField(key).focus.get}""".stripMargin
        )
        checkMultiLines(expectedValue, result, sd)
    else
      scenarioData.error(s"$key did NOT exist in $result")

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
      result: Json,
      scenarioData: ScenarioData
  ): ScenarioData =
    if checkExistsInResult(result, key) then
      result.hcursor.downField(key).focus match
        case Some(r) if r.isArray && expectedSize.asNumber.get.toInt.contains(r.asArray.get.size) =>
          scenarioData
        case _                                                                                    =>
          scenarioData.error(s"""Size of $key is different:
                                | - expected: ${expectedSize.asNumber.get.toInt}
                                | - result  : ${result.hcursor.downField(
                                 key
                               ).focus.get.asArray.get.size}""".stripMargin)
    else
      scenarioData.error(s"$key did NOT exist in $result")

  private def checkContains(
      key: String,
      expectedValue: Json,
      result: Json,
      scenarioData: ScenarioData
  ): ScenarioData =
    result.hcursor.downField(key).focus match
      case Some(r) if r.isArray =>
        if r.asArray.get.contains(expectedValue) then
          scenarioData
        else
          scenarioData.error(s"$key does NOT contains $expectedValue in $r")
      case Some(r)              =>
        scenarioData.error(s"$key is NOT an array in $result")
      case None                 =>
        scenarioData.error(s"$key does NOT exist in $result")

  private def checkJson(
      expectedJson: io.circe.Json,
      resultJson: io.circe.Json,
      key: String
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
                s"""Size of array is different:
                   | - expected: $expJsonArray
                   | - result  : $resJsonArray""".stripMargin
              )
            else
              expJsonArray.foldLeft(scenarioData): (sd, expJson) =>
                resJsonArray.find(_ == expJson) match
                  case Some(_) => sd
                  case None    =>
                    sd.error(
                      s"""Value not found in array:
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
              s"$path: ${expJson.noSpaces} (expected) != ${resJson.noSpaces} (result)"
            )
      else scenarioData

    compareJsons(expectedJson, resultJson, "", scenarioData)

  end checkJson

end ResultChecker
