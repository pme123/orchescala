package orchescala.simulation

import orchescala.domain.*
import orchescala.domain.CamundaVariable.CString
import orchescala.simulation.TestOverrideType.*
import zio.test.*

import scala.language.implicitConversions

/** The scenario names the DSL gives - checks on a process keep the name of the val. */
object SimulationDslSpec extends ZIOSpecDefault:

  private object Dsl extends SimulationDsl[Unit]:
    var simulated: Option[SSimulation]       = None
    protected def run(sim: SSimulation): Unit = simulated = Some(sim)

    lazy val example: Process[NoInput, NoOutput, NoInput] =
      Process(InOutDescr("my-process", NoInput(), NoOutput()), NoInput(), ProcessLabels.none)

    lazy val `Without check`: Process[NoInput, NoOutput, NoInput] = example

    lazy val `With checks`: ProcessScenario =
      example
        .exists("a")
        .isEquals("b", 1)

    lazy val `With hasSize`: ProcessScenario =
      example.hasSize(2)

    // one val per check - each must get the name of its val and add its own override
    lazy val CheckExists: ProcessScenario         = example.exists("a")
    lazy val CheckNotExists: ProcessScenario      = example.notExists("a")
    lazy val CheckIsEquals: ProcessScenario       = example.isEquals("a", 1)
    lazy val CheckHasSizeOfKey: ProcessScenario   = example.hasSize("a", 3)
    lazy val CheckHasSize: ProcessScenario        = example.hasSize(3)
    lazy val CheckContainsOfKey: ProcessScenario  = example.contains("a", CString("x"))
    lazy val CheckContains: ProcessScenario       = example.contains("x")

    val StrictVal: ProcessScenario  = example.exists("a")
    def InDef: ProcessScenario      = example.exists("a")
    lazy val InLambda: ProcessScenario = Seq(1).map(_ => example.exists("a")).head
    // known limit: several checked processes in one val all get the name of that val
    lazy val Several: Seq[ProcessScenario] = Seq(example.exists("a"), example.notExists("b"))

    lazy val withoutCheck: SScenario = scenario(`Without check`)
    lazy val withChecks: SScenario   = scenario(`With checks`)

    // outside of a val: the name of the process, as before
    simulate(scenario(example.exists("a")))
  end Dsl

  private def overrideOf(scen: ProcessScenario): Seq[TestOverride] =
    scen.testOverrides.toSeq.flatMap(_.overrides)

  def spec = suite("SimulationDsl - scenario names")(
    test("a process without check: the scenario is named after its val") {
      assertTrue(Dsl.withoutCheck.scenarioName == "Without check")
    },
    test("checks on a process keep the name of the val - not `example`") {
      assertTrue(
        Dsl.withChecks.scenarioName == "With checks",
        overrideOf(Dsl.`With checks`).map(_.overrideType) == Seq(Exists, IsEquals),
        Dsl.`With hasSize`.scenarioName == "With hasSize"
      )
    },
    test("each check on a process names the scenario after its val and adds its override") {
      val checks = Seq(
        Dsl.CheckExists        -> TestOverride(Some("a"), Exists),
        Dsl.CheckNotExists     -> TestOverride(Some("a"), NotExists),
        Dsl.CheckIsEquals      -> TestOverride(Some("a"), IsEquals, Some(CamundaVariable.valueToCamunda(1))),
        Dsl.CheckHasSizeOfKey  -> TestOverride(Some("a"), HasSize, Some(CamundaVariable.valueToCamunda(3))),
        Dsl.CheckHasSize       -> TestOverride(None, HasSize, Some(CamundaVariable.valueToCamunda(3))),
        Dsl.CheckContainsOfKey -> TestOverride(Some("a"), Contains, Some(CString("x"))),
        Dsl.CheckContains      -> TestOverride(None, Contains, Some(CamundaVariable.valueToCamunda("x")))
      )
      assertTrue(
        checks.map(_._1.scenarioName) == Seq(
          "CheckExists",
          "CheckNotExists",
          "CheckIsEquals",
          "CheckHasSizeOfKey",
          "CheckHasSize",
          "CheckContainsOfKey",
          "CheckContains"
        ),
        checks.forall((scen, expected) => overrideOf(scen) == Seq(expected))
      )
    },
    test("a strict val, a def and a lambda inside a val are named after the val or def") {
      assertTrue(
        Dsl.StrictVal.scenarioName == "StrictVal",
        Dsl.InDef.scenarioName == "InDef",
        Dsl.InLambda.scenarioName == "InLambda"
      )
    },
    test("several checked processes in one val get the name of that val (known limit)") {
      assertTrue(Dsl.Several.map(_.scenarioName) == Seq("Several", "Several"))
    },
    test("a check outside of a val: the scenario keeps the name of the process") {
      assertTrue(Dsl.simulated.toSeq.flatMap(_.scenarios.map(_.scenarioName)) == Seq("example"))
    }
  )
end SimulationDslSpec
