package orchescala.helper.dev.company

import munit.FunSuite
import orchescala.engine.domain.EngineType
import orchescala.engine.domain.EngineType.*
import orchescala.helper.util.DevConfig

/** The company wrappers for each combination of engines - `sbt companyCheck` compiles only
  * `C7 C8 Op`, the branching on the engines is checked here.
  */
class CompanyWrapperGeneratorTest extends FunSuite:

  // the engines -> the engine context of CompanyWorkerApp
  private val combinations = Seq(
    Seq(C7)         -> "CompanyEngineContext",
    Seq(C8)         -> "CompanyEngineC8Context",
    Seq(Op)         -> "CompanyEngineOpContext",
    Seq(C7, C8)     -> "CompanyEngineContext",
    Seq(C7, Op)     -> "CompanyEngineContext",
    Seq(C8, Op)     -> "CompanyEngineC8Context",
    Seq(Op, C8)     -> "CompanyEngineOpContext",
    Seq(C7, C8, Op) -> "CompanyEngineContext",
    Seq(Op, C7)     -> "CompanyEngineContext"
  )

  /** A company project in a temporary directory - removed afterwards. */
  private def inCompany(body: DevConfig ?=> os.Path => Unit): Unit =
    val dir = os.temp.dir(prefix = "company-wrapper-")
    try
      os.dynamicPwd.withValue(dir):
        given DevConfig = DevConfig.configForCompany("democompany-orchescala")
        body(dir / "democompany-orchescala")
    finally os.remove.all(dir)

  private def generated(engines: Seq[EngineType])(check: Generated => Unit): Unit =
    inCompany: projectDir =>
      CompanyWrapperGenerator().generate(engines)
      CompanySbtGenerator(engines).generate
      check(Generated(projectDir))

  private case class Generated(projectDir: os.Path):
    private val base                             = os.RelPath("src/main/scala/democompany/orchescala")
    def path(module: String, file: String)       = projectDir / module / base / module.drop(3) / file
    def exists(module: String, file: String)     = os.exists(path(module, file))
    def read(module: String, file: String)       = os.read(path(module, file))
    def worker: String                           = read("03-worker", "CompanyWorker.scala")
    def workerApp: String                        = read("03-worker", "CompanyWorkerApp.scala")
    def simulation: String                       = read("03-simulation", "CompanySimulation.scala")
    def gateway: String                          = read("04-gateway", "GatewayServerApp.scala")
    def sbtSettings: String                      = os.read(projectDir / "project" / "Settings.scala")
  end Generated

  Seq(Seq.empty[EngineType], Seq(Gateway)).foreach: engines =>
    test(s"no company engine (${engines.mkString(" ")}): fails with a clear message"):
      val error = intercept[IllegalArgumentException](generated(engines)(_ => ()))
      assert(error.getMessage.contains("at least one of C7, C8 or Op"), error.getMessage)

  test("a company adding Op later: the worker-op dependency comes with the re-generated Settings"):
    inCompany: projectDir =>
      val settings    = projectDir / "project" / "Settings.scala"
      val workerOpDep = """"io.github.pme123" %% "orchescala-worker-op" % orchescalaV"""
      CompanySbtGenerator(Seq(C7, C8)).generate
      assert(!os.read(settings).contains(workerOpDep))
      CompanySbtGenerator(Seq(C7, C8, Op)).generate
      assert(os.read(settings).contains(workerOpDep))

  test("a company adding Op later: the existing CompanyWorker misses Op"):
    inCompany: _ =>
      val generator = CompanyWrapperGenerator()
      generator.generate(Seq(C7, C8))
      assertEquals(generator.missingInCompanyWorker(Seq(C7, C8)), Seq.empty)
      generator.generate(Seq(C7, C8, Op))
      assertEquals(generator.missingInCompanyWorker(Seq(C7, C8, Op)), Seq(Op))

  combinations.foreach: (engines, engineContext) =>
    val name  = engines.mkString(" ")
    val hasC7 = engines.contains(C7)
    val hasC8 = engines.contains(C8)
    val hasOp = engines.contains(Op)

    test(s"$name: the engine specific files"):
      generated(engines): g =>
        Seq(
          "02-engine"     -> "CompanyEngineC7Config.scala",
          "02-engine"     -> "CompanyEngineC7App.scala",
          "03-simulation" -> "CompanyC7Simulation.scala",
          "03-worker"     -> "CompanyEngineContext.scala",
          "03-worker"     -> "CompanyC7Client.scala"
        ).foreach((m, f) => assertEquals(g.exists(m, f), hasC7, f))
        Seq(
          "02-engine"     -> "CompanyEngineC8Config.scala",
          "02-engine"     -> "CompanyEngineC8App.scala",
          "03-simulation" -> "CompanyC8Simulation.scala",
          "03-worker"     -> "CompanyEngineC8Context.scala",
          "03-worker"     -> "CompanyC8Client.scala"
        ).foreach((m, f) => assertEquals(g.exists(m, f), hasC8, f))
        Seq(
          "02-engine"     -> "CompanyEngineOpConfig.scala",
          "02-engine"     -> "CompanyEngineOpApp.scala",
          "03-simulation" -> "CompanyOpSimulation.scala",
          "03-worker"     -> "CompanyEngineOpContext.scala",
          "03-worker"     -> "CompanyOpClient.scala"
        ).foreach((m, f) => assertEquals(g.exists(m, f), hasOp, f))
        if hasOp then
          assert(
            g.read("03-simulation", "CompanyOpSimulation.scala")
              .contains("directly against Operaton")
          )

    test(s"$name: CompanyWorker"):
      generated(engines): g =>
        val worker = g.worker
        // always in the order C7, C8, Op - whatever the order of the engines
        val mixins = Seq(C7, C8, Op).filter(engines.contains)
        assert(
          worker.contains(s"extends ${mixins.map(e => s"${e}Worker[In, Out]").mkString(", ")}:"),
          worker
        )
        assertEquals(worker.contains("import orchescala.worker.op.{OpContext, OpWorker}"), hasOp)
        assertEquals(
          worker.contains(
            "protected def operatonContext: OpContext = CompanyEngineOpContext(CompanyRestApiClient())"
          ),
          hasOp
        )
        assertEquals(worker.contains("protected def c7Context: C7Context"), hasC7)
        assertEquals(worker.contains("protected def c8Context: C8Context"), hasC8)
        // C7Worker and OpWorker both implement the logger
        assertEquals(
          worker.contains("override def logger: OrchescalaLogger = super[C7Worker].logger"),
          hasC7 && hasOp
        )

    test(s"$name: CompanyWorkerApp"):
      generated(engines): g =>
        val app = g.workerApp
        assert(app.contains(s"lazy val engineContext: EngineContext = $engineContext("), app)
        val registries = engines.map(e => s"${e}WorkerRegistry(Company${e}Client)").mkString(", ")
        assert(app.contains(s"Seq($registries)"), app)

    test(s"$name: CompanySimulation and GatewayServerApp"):
      generated(engines): g =>
        val simulation = g.simulation
        assertEquals(simulation.contains("EngineType.C7 -> CompanyEngineC7Config.c7CockpitUrl"), hasC7)
        assertEquals(simulation.contains("EngineType.C8 -> CompanyEngineC8Config.c8OperateUrl"), hasC8)
        assertEquals(simulation.contains("EngineType.Op -> CompanyEngineOpConfig.opCockpitUrl"), hasOp)
        val gateway = g.gateway
        assertEquals(gateway.contains("lazy val c7Client = C7DefaultBearerTokenClient(c7RestUrl)"), hasC7)
        assertEquals(
          gateway.contains("lazy val c8Client = C8DefaultBearerTokenClient(c8GrpcUrl, c8RestUrl)"),
          hasC8
        )
        assertEquals(gateway.contains("lazy val opClient = OpDefaultBearerTokenClient(opRestUrl)"), hasOp)
        assert(
          gateway.contains(
            s"given Seq[ProcessEngine] = Seq(${engines.map(e => s"${e.toString.toLowerCase}Engine").mkString(", ")})"
          ),
          gateway
        )

    test(s"$name: worker dependencies of the company build"):
      generated(engines): g =>
        val settings = g.sbtSettings
        // Camunda 7 and 8 are always there (as before the engines were passed)
        assert(settings.contains(""""io.github.pme123" %% "orchescala-worker-c7" % orchescalaV"""))
        assert(settings.contains(""""io.github.pme123" %% "orchescala-worker-c8" % orchescalaV"""))
        assertEquals(
          settings.contains(""""io.github.pme123" %% "orchescala-worker-op" % orchescalaV"""),
          hasOp
        )

end CompanyWrapperGeneratorTest
