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
    def engineFile(c8: Boolean): Unit =
      createIfNotExists(simulationTestPath / s"$name${engineSuffix(c8)}Simulation.scala", engineSimulation(pkg, name, c8))
    if !os.exists(baseFile) then
      if c8 then
        createIfNotExists(baseFile, abstractSimulation(process(setupElement), name).getOrElse(process(setupElement)))
        engineFile(c8 = true)
      else createIfNotExists(baseFile, process(setupElement))
    else
      val base = os.read(baseFile)
      engineOf(base, name) match
        case Some(`c8`)  => println(s"EXISTS: $baseFile")
        case Some(other) =>
          abstractSimulation(base, name) match
            case Some(abstractBase) =>
              os.write.over(baseFile, abstractBase)
              println(s"${Console.BLUE} - SPLIT: $baseFile - scenarios for both engines${Console.RESET}")
              engineFile(other)
              engineFile(c8)
            case None               =>
              println(s"${Console.YELLOW}EXISTS: $baseFile - not split for ${engineSuffix(c8)}, do it by hand.${Console.RESET}")
        case None        =>
          println(s"EXISTS: $baseFile")
          if isAbstract(base, name) then engineFile(c8)
      end match
    end if
  end createSimulation

  private def process(
      setupElement: SetupElement
  ) =
    val SetupElement(_, processName, name, version) = setupElement
    s"""package ${config.projectPackage}
       |package simulation
       |
       |import ${config.projectPackage}.domain.$processName${version.versionPackage}.$name.*
       |
       |// ./helper.scala deploy ${name}Simulation
       |// simulation/test
       |// simulation/testOnly *${name}Simulation
       |class ${name}Simulation extends CompanySimulation:
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

  private def classLine(name: String) =
    s"""(?m)^class ${name}Simulation\\s+extends\\s+(CompanySimulation|CompanyC8Simulation)\\s*:[ \\t]*$$""".r

  /** The engine of a concrete `<Name>Simulation` - None if it is abstract or has another form */
  def engineOf(base: String, name: String): Option[Boolean] =
    classLine(name).findFirstMatchIn(base).map(_.group(1) == "CompanyC8Simulation")

  def isAbstract(base: String, name: String): Boolean =
    s"""(?m)^abstract class ${name}Simulation\\b""".r.findFirstIn(base).isDefined

  /** The concrete simulation as the abstract one with the scenarios of both engines - without
    * the deploy comments, they belong to the classes of the engines.
    */
  def abstractSimulation(base: String, name: String): Option[String] =
    classLine(name).findFirstMatchIn(base).map: m =>
      val withClass = base.patch(
        m.start,
        s"""// Shared scenarios for both engines; the engine wiring comes from CompanySimulation /
           |// CompanyC8Simulation on the concrete subclasses (${name}C7Simulation /
           |// ${name}C8Simulation), not from here.
           |abstract class ${name}Simulation extends SimulationRunner:""".stripMargin,
        m.end - m.start
      )
      val deployComment =
        s"(?m)^// (\\./helper\\.scala deploy ${name}Simulation|simulation/test|simulation/testOnly \\*${name}Simulation)[ \\t]*\\n".r
      deployComment.replaceAllIn(withClass, "")

  /** `<Name>C7Simulation` / `<Name>C8Simulation` - the scenarios of `<Name>Simulation` on the engine */
  def engineSimulation(pkg: String, name: String, c8: Boolean): String =
    val sim         = s"$name${engineSuffix(c8)}Simulation"
    val note        = if c8 then "   (engine C8 from the name, Postman folder deploy_manifest_c8)" else ""
    val engineTrait = if c8 then "CompanyC8Simulation" else "CompanySimulation"
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
