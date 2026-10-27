package orchescala.simulation

import orchescala.domain.*
import zio.test.*

import scala.language.implicitConversions

/** The scenario names the DSL gives - checks on a process keep the name of the val. */
object SimulationDslSpec extends ZIOSpecDefault:

  private object Dsl extends SimulationDsl[Unit]:
    protected def run(sim: SSimulation): Unit = ()

    lazy val example: Process[NoInput, NoOutput, NoInput] =
      Process(InOutDescr("my-process", NoInput(), NoOutput()), NoInput(), ProcessLabels.none)

    lazy val `Without check`: Process[NoInput, NoOutput, NoInput] = example

    lazy val `With checks`: ProcessScenario =
      example
        .exists("a")
        .isEquals("b", 1)

    lazy val `With hasSize`: ProcessScenario =
      example.hasSize(2)

    lazy val withoutCheck: SScenario = scenario(`Without check`)
    lazy val withChecks: SScenario   = scenario(`With checks`)
  end Dsl

  def spec = suite("SimulationDsl - scenario names")(
    test("a process without check: the scenario is named after its val") {
      assertTrue(Dsl.withoutCheck.scenarioName == "Without check")
    },
    test("checks on a process keep the name of the val - not `example`") {
      assertTrue(
        Dsl.withChecks.scenarioName == "With checks",
        Dsl.`With checks`.testOverrides.map(_.overrides.size).contains(2),
        Dsl.`With hasSize`.scenarioName == "With hasSize"
      )
    }
  )
end SimulationDslSpec
