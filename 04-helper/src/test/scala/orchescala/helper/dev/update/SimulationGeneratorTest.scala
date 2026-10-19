package orchescala.helper.dev.update

import munit.FunSuite
import orchescala.api.{ApiProjectConfig, ModuleType, VersionConfig}
import orchescala.helper.util.DevConfig

/** The simulation of a process: one class in Camunda 7; in Camunda 8, or next to a simulation of
  * the other engine, the scenarios in an abstract class and one class per engine on top - the
  * deploy takes the engine from that name (`…C8Simulation`).
  */
class SimulationGeneratorTest extends FunSuite:

  private def inProject(body: DevConfig ?=> (String => Option[String]) => Unit): Unit =
    val dir = os.temp.dir(prefix = "project-simulation-")
    try
      os.dynamicPwd.withValue(dir):
        given DevConfig = DevConfig(
          ApiProjectConfig(
            "democompany-customer",
            VersionConfig("0.1.0-SNAPSHOT"),
            Seq.empty,
            Seq.empty,
            Seq.empty,
            ModuleType.projectModules
          )
        )
        def file(name: String): Option[String] =
          os.walk(dir).find(_.last == s"$name.scala").map(os.read(_))
        body(file)
    finally os.remove.all(dir)

  private def element(using DevConfig) = SetupElement("Process", "order", "OrderCard", Some(1))

  test("Camunda 7: one class OrderCardSimulation - as before"):
    inProject: file =>
      SimulationGenerator().createSimulation(element)
      val sim = file("OrderCardSimulation").get
      assert(sim.contains("class OrderCardSimulation extends CompanySimulation:"), sim)
      assertEquals(file("OrderCardC7Simulation"), None)

  test("Camunda 8: the scenarios in an abstract class, OrderCardC8Simulation on top"):
    inProject: file =>
      SimulationGenerator().createSimulation(element, c8 = true)
      val base = file("OrderCardSimulation").get
      assert(base.contains("abstract class OrderCardSimulation extends SimulationRunner:"), base)
      assert(base.contains("scenario(`OrderCard`)"), base)
      assert(!base.contains("./helper.scala deploy"), base)
      val c8 = file("OrderCardC8Simulation").get
      assert(c8.contains("class OrderCardC8Simulation extends OrderCardSimulation, CompanyC8Simulation"), c8)
      assert(c8.contains("// ./helper.scala deploy OrderCardC8Simulation"), c8)
      assertEquals(file("OrderCardC7Simulation"), None)

  test("Camunda 8 next to an existing C7 simulation: it is split - its scenarios stay"):
    inProject: file =>
      SimulationGenerator().createSimulation(element)
      val c7Before = file("OrderCardSimulation").get
      SimulationGenerator().createSimulation(element, c8 = true)
      val base     = file("OrderCardSimulation").get
      assert(base.contains("abstract class OrderCardSimulation extends SimulationRunner:"), base)
      assertEquals(
        base.linesIterator.dropWhile(!_.startsWith("abstract class")).drop(1).mkString("\n"),
        c7Before.linesIterator.dropWhile(!_.startsWith("class")).drop(1).mkString("\n")
      )
      val c7 = file("OrderCardC7Simulation").get
      assert(c7.contains("class OrderCardC7Simulation extends OrderCardSimulation, CompanySimulation"), c7)
      assert(file("OrderCardC8Simulation").isDefined)

  test("a re-run changes nothing - the abstract simulation and both engines stay"):
    inProject: file =>
      SimulationGenerator().createSimulation(element)
      SimulationGenerator().createSimulation(element, c8 = true)
      val before = Seq("OrderCardSimulation", "OrderCardC7Simulation", "OrderCardC8Simulation").map(file)
      SimulationGenerator().createSimulation(element, c8 = true)
      SimulationGenerator().createSimulation(element)
      assertEquals(Seq("OrderCardSimulation", "OrderCardC7Simulation", "OrderCardC8Simulation").map(file), before)

  test("abstractSimulation - the class line and the deploy comments, nothing else"):
    val base =
      """package acme
        |package simulation
        |
        |// ./helper.scala deploy OrderCardSimulation
        |// simulation/test
        |// simulation/testOnly *OrderCardSimulation
        |class OrderCardSimulation extends CompanySimulation:
        |
        |  simulate(scenario(`OrderCard`)())
        |  // simulation/test stays inside
        |end OrderCardSimulation""".stripMargin
    val result = SimulationGenerator.abstractSimulation(base, "OrderCard").get
    assert(!result.contains("deploy OrderCardSimulation"), result)
    assert(result.contains("abstract class OrderCardSimulation extends SimulationRunner:\n\n  simulate"), result)
    assert(result.contains("  // simulation/test stays inside"), result)
    assertEquals(SimulationGenerator.engineOf(base, "OrderCard"), Some(false))
    assertEquals(SimulationGenerator.engineOf(result, "OrderCard"), None)
    assert(SimulationGenerator.isAbstract(result, "OrderCard"))

  test("abstractSimulation - another form is not touched"):
    val other = "class OrderCardSimulation extends CompanySimulation, MyMixin:\n"
    assertEquals(SimulationGenerator.abstractSimulation(other, "OrderCard"), None)
    assertEquals(SimulationGenerator.engineOf(other, "OrderCard"), None)

end SimulationGeneratorTest
