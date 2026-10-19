package orchescala.helper.dev.update

import orchescala.api.ModuleType

case class SimulationGenerator()(using config: DevConfig):

  def generate: Unit =
    if config.apiProjectConfig.modules.contains(ModuleType.simulation) then
      createOrUpdate(simulationConfigTestPath / "logback.xml", WorkerGenerator().logbackXml)
  end generate

  /** The simulation of a process. Camunda 7 (`c8 = false`): one class `<Name>Simulation`.
    * Camunda 8, or a process that already has a simulation for the other engine: the scenarios in
    * an abstract `<Name>Simulation`, and one class per engine on top (`<Name>C7Simulation`,
    * `<Name>C8Simulation`) - the deploy takes the engine from that name. An existing concrete
    * simulation of the other engine is split that way; its scenarios stay as they are.
    */
  def createSimulation(setupElement: SetupElement, c8: Boolean = false): Unit =
    import SimulationGenerator.*
    val name     = setupElement.bpmnName
    val baseFile = simulationTestPath / s"${name}Simulation.scala"
    val pkg      = config.projectPackage
    // C7 directly (CompanyC7Simulation, newer company projects) - or as before over CompanySimulation;
    // only looked up when a C7 class is written, and before a split rewrites the base
    lazy val c7Trait =
      val known = os.exists(simulationTestPath) &&
        os.list(simulationTestPath).filter(_.ext == "scala").exists(f => os.read(f).contains(C7Trait))
      if known then C7Trait else "CompanySimulation"
    def engineFile(c8: Boolean): Unit =
      createIfNotExists(
        simulationTestPath / s"$name${engineSuffix(c8)}Simulation.scala",
        engineSimulation(pkg, name, c8, c7Trait)
      )
    if !os.exists(baseFile) then
      if c8 then
        engineFile(c8 = true)
        createIfNotExists(baseFile, process(setupElement, asAbstract = true))
      else createIfNotExists(baseFile, process(setupElement))
    else
      val base = os.read(baseFile)
      engineOf(base, name) match
        case Some(`c8`)  => println(s"EXISTS: $baseFile")
        case Some(other) =>
          abstractSimulation(base, name) match
            case Some(abstractBase) =>
              // the classes of the engines first - the base is only rewritten when they are there
              engineFile(other)
              engineFile(c8)
              os.write.over(baseFile, abstractBase)
              println(s"${Console.BLUE} - SPLIT: $baseFile - scenarios for both engines${Console.RESET}")
            case None               =>
              println(s"${Console.YELLOW}EXISTS: $baseFile - not split for ${engineSuffix(c8)}, do it by hand.${Console.RESET}")
        case None        =>
          if isAbstract(base, name) then
            println(s"EXISTS: $baseFile")
            engineFile(c8)
          else if c8 then
            println(s"${Console.YELLOW}EXISTS: $baseFile - unknown form, not split for C8 - do it by hand.${Console.RESET}")
          else println(s"EXISTS: $baseFile")
      end match
    end if
  end createSimulation

  /** The simulation with its scenarios - `asAbstract`: the base of the classes per engine */
  private def process(
      setupElement: SetupElement,
      asAbstract: Boolean = false
  ) =
    import SimulationGenerator.*
    val SetupElement(_, processName, name, version) = setupElement
    val header =
      if asAbstract then abstractHeader(name)
      else
        s"""// ./helper.scala deploy ${name}Simulation
           |// simulation/test
           |// simulation/testOnly *${name}Simulation
           |class ${name}Simulation extends CompanySimulation:""".stripMargin
    s"""package ${config.projectPackage}
       |package simulation
       |
       |import ${config.projectPackage}.domain.$processName${version.versionPackage}.$name.*
       |
       |$header
       |
       |  simulate(
       |    scenario(`$name`)(
       |      //TODO remove or add process steps like UserTasks
       |    ),
       |    scenario(`$name minimal`)(
       |      //TODO remove or add process steps like UserTasks
       |    )
       |  )
       |
       |  override def config =
       |    super.config
       |      //.withMaxCount(30)
       |      //.withLogLevel(LogLevel.DEBUG)
       |
       |  private lazy val `$name` =
       |    example
       |      .mockServices
       |      .mockWorkers(workers*)
       |
       |  private lazy val `$name minimal` =
       |    exampleMinimal
       |      .mockServices
       |      .mockWorkers(workers*)
       |
       |  private lazy val workers = Seq()
       |
       |end ${name}Simulation""".stripMargin
  end process

  private lazy val simulationTestPath =
    val dir = config.projectDir / ModuleConfig.simulationModule.packagePath(
      config.projectPath,
      mainOrTest = "test"
    )
    os.makeDir.all(dir)
    dir
  end simulationTestPath

  private lazy val simulationConfigTestPath =
    val dir = config.projectDir / ModuleConfig.simulationModule.packagePath(
      config.projectPath,
      isSourceDir = false,
      mainOrTest = "test"
    )
    os.makeDir.all(dir)
    dir
  end simulationConfigTestPath

end SimulationGenerator

object SimulationGenerator:

  /** `C7` or `C8` - the part of the class name the deploy takes the engine from */
  def engineSuffix(c8: Boolean): String = if c8 then "C8" else "C7"

  /** The simulation trait of C7 in newer company projects - runs directly against Camunda 7 */
  val C7Trait = "CompanyC7Simulation"

  /** The class line of a concrete simulation - a comment behind it stays */
  private def classLine(name: String) =
    s"""(?m)^class ${name}Simulation\\s+extends\\s+(CompanySimulation|$C7Trait|CompanyC8Simulation)\\s*:[ \\t]*(//.*)?$$""".r

  private def abstractHeader(name: String) =
    s"""// Shared scenarios for both engines; the engine wiring comes from CompanySimulation /
       |// CompanyC8Simulation on the concrete subclasses (${name}C7Simulation /
       |// ${name}C8Simulation), not from here.
       |abstract class ${name}Simulation extends SimulationRunner:""".stripMargin

  /** The engine of a concrete `<Name>Simulation` (C8: true) - None if it is abstract or has another
    * form (another engine like CompanyOpSimulation, more mixins)
    */
  def engineOf(base: String, name: String): Option[Boolean] =
    classLine(name).findFirstMatchIn(base).map(_.group(1) == "CompanyC8Simulation")

  def isAbstract(base: String, name: String): Boolean =
    s"""(?m)^abstract class ${name}Simulation\\b""".r.findFirstIn(base).isDefined

  /** The concrete simulation as the abstract one with the scenarios of both engines - without
    * the deploy comments, they belong to the classes of the engines.
    */
  def abstractSimulation(base: String, name: String): Option[String] =
    classLine(name).findFirstMatchIn(base).map: m =>
      val comment   = Option(m.group(2)).map(c => s" $c").getOrElse("")
      val withClass = base.patch(m.start, abstractHeader(name) + comment, m.end - m.start)
      val deployComment =
        s"(?m)^// (\\./helper\\.scala deploy ${name}Simulation|simulation/test|simulation/testOnly \\*${name}Simulation)[ \\t]*\\n".r
      deployComment.replaceAllIn(withClass, "")

  /** `<Name>C7Simulation` / `<Name>C8Simulation` - the scenarios of `<Name>Simulation` on the engine */
  def engineSimulation(pkg: String, name: String, c8: Boolean, c7Trait: String = "CompanySimulation"): String =
    val sim         = s"$name${engineSuffix(c8)}Simulation"
    val note        = if c8 then "   (engine C8 from the name, Postman folder deploy_manifest_c8)" else ""
    val engineTrait = if c8 then "CompanyC8Simulation" else c7Trait
    s"""package $pkg
       |package simulation
       |
       |// ./helper.scala deploy $sim$note
       |// simulation/test
       |// simulation/testOnly *$sim
       |class $sim extends ${name}Simulation, $engineTrait
       |""".stripMargin
  end engineSimulation

end SimulationGenerator
