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

trait ResultChecker[
    In <: Product: {InOutEncoder, InOutDecoder},
    Out <: Product: {InOutEncoder, InOutDecoder, ClassTag},
    T <: InOut[In, Out, T]
]:
  def scenarioData: ScenarioData

  def checkProps(
      withOverrides: WithTestOverrides[In, Out, ?],
      result: Out,
      scenarioData: ScenarioData
  ): ScenarioData =
    withOverrides.testOverrides match
      case Some(TestOverrides(overrides)) =>
        checkO(overrides, result, scenarioData)
      case _                              =>
        checkP(withOverrides.inOut.out, result, scenarioData)
    end match
  end checkProps

  private def checkO(
      overrides: Seq[TestOverride],
      result: Out,
      scenarioData: ScenarioData
  ): ScenarioData =
    overrides
      .foldLeft(scenarioData) : (scenarioData, testOverride) =>
        testOverride match
          case TestOverride(Some(k), Exists, _)             =>
            checkExistsInResult(result, k, scenarioData)
          case TestOverride(Some(k), NotExists, _)          =>
            val matches = !result.productElementNames.contains(k)
            if !matches then
              scenarioData.error(s"$k did EXIST in $result")
            else
              scenarioData
          case TestOverride(Some(k), IsEquals, Some(v))     =>
            result
              .productElementNames
              .zip(result.productIterator)
              .find(_._1 == k)
              .map:
                case (key, value) =>
                  checkIsEqualValue(key, v, value, scenarioData)
              .getOrElse:
                scenarioData.error(s"$k did NOT exist in $result")
          case TestOverride(Some(k), HasSize, Some(value))  =>
            result.productElementNames.find(_ == k)
              .map:
                case it: Iterable[?] if it.size == value =>
                  scenarioData
                case it: Iterable[?] =>
                  scenarioData.error(
                    s"$k does NOT have the correct size $value in $it"
                  )
                case _           =>
                  scenarioData.error(s"$k is not a collection in $result")
              .getOrElse:
                scenarioData.error(s"$k did NOT exist in $result")

          case TestOverride(Some(k), Contains, Some(value)) =>
            result.productElementNames.find(_ == k)
              .map:
                case it: Iterable[?] if it.contains(value) =>
                  scenarioData
                case it: Iterable[?] =>
                  scenarioData.error(
                    s"$k does NOT contains $value in $it"
                  )
                case _           => 
                  scenarioData.error(s"$k is not a collection in $result")
              .getOrElse:    
                  scenarioData.error(s"$k did NOT exist in $result")

          case _                                            =>
            scenarioData.error(
              s"!!! Only ${TestOverrideType.values.mkString(", ")} for TestOverrides supported."
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
      expected: Out,
      result: Out,
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
      result: Out,
      key: String,
      scenarioData: ScenarioData
  ): ScenarioData =
    val matches = result.productElementNames.contains(key)
    if !matches then
      scenarioData.error(s"$key did NOT exist in $result")
    else
      scenarioData
  end checkExistsInResult

  private def checkIsEqualValue(
      key: String,
      expectedValue: Any,
      resultValue: Any,
      scenarioData: ScenarioData
  ): ScenarioData =
    val matches: Boolean = resultValue == expectedValue
    if !matches then
      val scData = scenarioData.error(
        s"""The value of $key is different:
           | - expected: ${expectedValue}
           | - result  : ${resultValue}""".stripMargin
      )
      if resultValue.getClass != expectedValue.getClass then
        scData.error(
          s"""The type of $key is different:
             | - expected: ${expectedValue.getClass} 
             | - result  : ${resultValue.getClass}""".stripMargin
        )
      else
        checkMultiLines(expectedValue, resultValue, scData)
      end if
    else
      scenarioData
    end if
  end checkIsEqualValue

  private def checkMultiLines(expectedValue: Any, resultValue: Any, scData: ScenarioData) = {
    if expectedValue.toString.contains("\n") then // compare each line for complex strings
      val result = resultValue.toString.split("\n")
      val expected = expectedValue.toString.split("\n")
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
  }

  private def checkJson(
      expectedJson: io.circe.Json,
      resultJson: io.circe.Json,
      key: String
  ): Boolean =
    val diffs: ListBuffer[String] = ListBuffer()
    def compareJsons(
        expJson: io.circe.Json,
        resJson: io.circe.Json,
        path: String
    ): Unit =
      if expJson != resJson then
        (expJson, resJson) match
          case _ if expJson.isArray && resJson.isArray   =>
            val expJsonArray = expJson.asArray.toList.flatten
            val resJsonArray = resJson.asArray.toList.flatten
            for
              (expJson, resJson) <- expJsonArray.zipAll(
                                      resJsonArray,
                                      Json.Null,
                                      Json.Null
                                    )
            do
              compareJsons(
                expJson,
                resJson,
                s"$path[${expJsonArray.indexOf(expJson)}]"
              )
            end for
          case _ if expJson.isObject && resJson.isObject =>
            val expJsonObj = expJson.asObject.get
            val resJsonObj = resJson.asObject.get
            val expKeys    = expJsonObj.keys.toSeq
            val resKeys    = resJsonObj.keys.toSeq
            val commonKeys = expKeys.intersect(resKeys).toSet
            val uniqueKeys = (expKeys ++ resKeys).toSet.diff(commonKeys)
            for key <- commonKeys do
              compareJsons(
                expJsonObj(key).get,
                resJsonObj(key).get,
                s"$path.$key"
              )
            end for
            for key <- uniqueKeys do
              if expKeys.contains(key) then
                expJsonObj(key).foreach { json =>
                  diffs += s"$path.$key: ${json.noSpaces} (expected field not in result)"
                }
              else
                resJsonObj(key).foreach { json =>
                  diffs += s"$path.$key: ${json.noSpaces} (field in result not expected)"
                }
            end for
          case _                                         =>
            diffs += s"$path: ${expJson.noSpaces} (expected) != ${resJson.noSpaces} (result)"

    compareJsons(expectedJson, resultJson, "")

    if diffs.nonEmpty then
      println(
        s"!!! The JSON variable $key have the following different fields:"
      )
      for diff <- diffs do
        println(diff)
    end if
    diffs.isEmpty
  end checkJson

end ResultChecker
