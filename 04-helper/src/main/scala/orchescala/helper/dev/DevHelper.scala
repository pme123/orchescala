package orchescala.helper.dev

import orchescala.api.ApiConfig
import orchescala.engine.domain.EngineType
import orchescala.helper.dev.deploy.DeployHelper
import orchescala.helper.dev.docker.DockerHelper
import orchescala.helper.dev.publish.PublishHelper
import orchescala.helper.util.*
import orchescala.helper.dev.update.*

import scala.util.{Failure, Success, Try}

trait DevHelper:
  def apiConfig: ApiConfig
  def devConfig: DevConfig

  given DevConfig = devConfig
  given ApiConfig = apiConfig

  def run(command: String, arguments: String*): Unit =
    run(command, arguments.toSeq, runCommand)
  end run

  private def run(
      command: String,
      arguments: Seq[String],
      commandFunc: (Command, Seq[String]) => Unit,
      availableCommands: Seq[Command] = Command.values.toSeq
  ): Unit =
    val args = arguments.toSeq
    println(s"Running command: $command with args: $args")
    Try(Command.valueOf(command)) match
      case Success(cmd) =>
        commandFunc(cmd, args)
      case Failure(_)   =>
        println(s"Command not found: $command")
        println("Available commands: " + availableCommands.mkString(", "))
    end match
  end run

  private def runCommand(command: Command, args: Seq[String]): Unit =
    command match
      case Command.update       =>
        update()
      // start code generation
      case Command.process      =>
        args match
          case Seq(processName)                                           =>
            createProcess(processName, None)
          case Seq(processName, version) if version.toIntOption.isDefined =>
            createProcess(processName, version.toIntOption)
          case other                                                      =>
            println(s"Invalid arguments for command $command: $other")
            println("Usage: process <processName> [version: Int]")
            println("Example: process myProcess 1")
      case Command.processFromSpec =>
        args match
          // copy & paste: first the BPMN, then the Scala classes
          case Seq()                        =>
            createProcessFromSpec(Some(OrchSpecInput.bpmn()), OrchSpecInput.scalaClasses())
          // «Process from Spec» in Orch Spec: BPMN and Scala classes in one argument.
          // The copied text is the whole command - pasted after a typed `./helper.scala processFromSpec`
          // the command is doubled: so take the `orchspec:` argument wherever it is.
          case arguments if arguments.exists(_.trim.startsWith(OrchSpecInput.commandPrefix)) =>
            val argument             = arguments.find(_.trim.startsWith(OrchSpecInput.commandPrefix)).get
            val (bpmn, scalaClasses) = OrchSpecInput.fromCommand(argument.trim)
            createProcessFromSpec(bpmn, scalaClasses)
          case Seq(bpmnExport, scalaExport) =>
            createProcessFromSpec(Some(readFile(bpmnExport)), readFile(scalaExport))
          case Seq(file) if file.endsWith(".bpmn")     =>
            createProcessFromSpec(Some(readFile(file)), "")
          case Seq(scalaExport)             =>
            createProcessFromSpec(None, readFile(scalaExport))
          case other                        =>
            println(s"Invalid arguments for command $command: $other")
            println(s"Usage: $command [bpmnExport] [scalaExport] | orchspec:…")
            println(s"Example: $command                    (copy & paste the BPMN and the Scala classes)")
            println(s"Example: $command orchspec:H4sI…     (Orch Spec: Export > Process from Spec)")
            println(s"Example: $command my-process-bpmn-c7.bpmn my-process-scala.scala")
      case Command.customTask   =>
        args match
          case Seq(processName, bpmnName)                                           =>
            createCustomTask(processName, bpmnName, None)
          case Seq(processName, bpmnName, version) if version.toIntOption.isDefined =>
            createCustomTask(processName, bpmnName, version.toIntOption)
          case other                                                                =>
            printBadActivity(command, other)
      case Command.serviceTask  =>
        args match
          case Seq(processName, bpmnName)                                           =>
            createServiceTask(processName, bpmnName, None)
          case Seq(processName, bpmnName, version) if version.toIntOption.isDefined =>
            createServiceTask(processName, bpmnName, version.toIntOption)
          case other                                                                =>
            printBadActivity(command, other)
      case Command.userTask     =>
        args match
          case Seq(processName, bpmnName)                                           =>
            createUserTask(processName, bpmnName, None)
          case Seq(processName, bpmnName, version) if version.toIntOption.isDefined =>
            createUserTask(processName, bpmnName, version.toIntOption)
          case other                                                                =>
            printBadActivity(command, other)
      case Command.decision     =>
        args match
          case Seq(processName, bpmnName)                                           =>
            createDecision(processName, bpmnName, None)
          case Seq(processName, bpmnName, version) if version.toIntOption.isDefined =>
            createDecision(processName, bpmnName, version.toIntOption)
          case other                                                                =>
            printBadActivity(command, other)
      case Command.signalEvent  =>
        args match
          case Seq(processName, bpmnName)                                           =>
            createSignalEvent(processName, bpmnName, None)
          case Seq(processName, bpmnName, version) if version.toIntOption.isDefined =>
            createSignalEvent(processName, bpmnName, version.toIntOption)
          case other                                                                =>
            printBadActivity(command, other)
      case Command.messageEvent =>
        args match
          case Seq(processName, bpmnName)                                           =>
            createMessageEvent(processName, bpmnName, None)
          case Seq(processName, bpmnName, version) if version.toIntOption.isDefined =>
            createMessageEvent(processName, bpmnName, version.toIntOption)
          case other                                                                =>
            printBadActivity(command, other)
      case Command.timerEvent   =>
        args match
          case Seq(processName, bpmnName)                                           =>
            createTimerEvent(processName, bpmnName, None)
          case Seq(processName, bpmnName, version) if version.toIntOption.isDefined =>
            createTimerEvent(processName, bpmnName, version.toIntOption)
          case other                                                                =>
            printBadActivity(command, other)
      // finish code generation
      case Command.publish      =>
        args match
          case Seq(version) =>
            PublishHelper().publish(version)
          case other        =>
            println(s"Invalid arguments for command $command: $other")
            println(s"Usage: $command <version>")
            println(s"Example: $command 1.23.3")

      case Command.deploy     =>
        def deploy(simulation: String, engineType: EngineType): Unit =
          devConfig.postmanConfig
            .map(DeployHelper(_).deploy(Some(simulation), engineType))
            .getOrElse(println("deploy is not supported as there is no deployConfig"))
        args match
          // engine derived from the simulation name (..C8Simulation -> C8, else C7)
          case Seq(simulation)             =>
            deploy(simulation, DeployHelper.engineTypeFromSimulation(simulation))
          // explicit engine wins over the naming convention
          case Seq(simulation, engineType) if Try(EngineType.valueOf(engineType)).isSuccess =>
            deploy(simulation, EngineType.valueOf(engineType))
          case other                       =>
            println(s"Invalid arguments for command $command: $other")
            println(s"Usage: $command <simulation> [engine: ${EngineType.values.mkString("|")}]")
            println(s"Example: $command OpenAccountSimulation")
            println(s"Example: $command OpenAccountC8Simulation      (deploys to C8 by naming convention)")
            println(s"Example: $command OpenAccountSimulation C8     (deploys to C8 by explicit argument)")
      // docker
      case Command.dockerUp   =>
        DockerHelper(devConfig.dockerConfig).dockerUp()
      case Command.dockerStop =>
        DockerHelper(devConfig.dockerConfig).dockerStop()
      case Command.dockerDown =>
        DockerHelper(devConfig.dockerConfig).dockerDown()

  private def printBadActivity(command: Command, args: Seq[String]): Unit =
    println(s"Invalid arguments for command $command: $args")
    println(s"Usage: $command <processName> <bpmnName> [version: Int]")
    println(s"Example: $command myProcess My$command 1")
  end printBadActivity

  private enum Command:
    case update, process, processFromSpec, customTask, serviceTask, userTask, decision, signalEvent, messageEvent,
      timerEvent, publish, deploy, dockerUp, dockerStop, dockerDown

  def update(): Unit =
    println(s"Update Project: ${devConfig.projectName}")
    println(s" - with Subprojects: ${devConfig.subProjects}")
    println(s" - Modules: ${devConfig.modules}")
    SetupGenerator().generate
    

  def createProcess(processName: String, version: Option[Int]): Unit =
    SetupGenerator().createProcess(SetupElement(
      "Process",
      processName.asProcessName,
      processName.asElemName,
      version
    ))
  end createProcess

  // creates the process from the exports of Orch Spec - the BPMN and the Scala classes
  def createProcessFromSpec(bpmn: Option[String], scalaClasses: String): Unit =
    OrchSpecGenerator().createProcess(bpmn, scalaClasses)

  private def readFile(path: String): String = os.read(os.Path(path, os.pwd))

  private def createCustomTask(processName: String, bpmnName: String, version: Option[Int]): Unit =
    SetupGenerator().createProcessElement(SetupElement(
      "CustomTask",
      processName.asProcessName,
      bpmnName.asElemName,
      version
    ))

  private def createServiceTask(processName: String, bpmnName: String, version: Option[Int]): Unit =
    SetupGenerator().createProcessElement(SetupElement(
      "ServiceTask",
      processName.asProcessName,
      bpmnName.asElemName,
      version
    ))

  private def createUserTask(processName: String, bpmnName: String, version: Option[Int]): Unit =
    SetupGenerator().createUserTask(
      SetupElement("UserTask", processName.asProcessName, bpmnName.asElemName, version)
    )

  private def createDecision(processName: String, bpmnName: String, version: Option[Int]): Unit =
    SetupGenerator().createDecision(
      SetupElement("Decision", processName.asProcessName, bpmnName.asElemName, version)
    )

  private def createSignalEvent(processName: String, bpmnName: String, version: Option[Int]): Unit =
    SetupGenerator().createEvent(SetupElement(
      "Signal",
      processName.asProcessName,
      bpmnName.asElemName,
      version
    ))

  private def createMessageEvent(
      processName: String,
      bpmnName: String,
      version: Option[Int]
  ): Unit =
    SetupGenerator().createEvent(SetupElement(
      "Message",
      processName.asProcessName,
      bpmnName.asElemName,
      version
    ))

  private def createTimerEvent(processName: String, bpmnName: String, version: Option[Int])(using
      config: DevConfig
  ): Unit =
    SetupGenerator().createEvent(
      SetupElement(
        "Timer",
        processName.asProcessName,
        bpmnName.asElemName,
        version
      ),
      withWorker = false
    )

  extension (name: String)
    private def asProcessName: String =
      s"${name.head.toLower}${name.tail}"
    private def asElemName: String    =
      s"${name.head.toUpper}${name.tail}"
  end extension
end DevHelper
