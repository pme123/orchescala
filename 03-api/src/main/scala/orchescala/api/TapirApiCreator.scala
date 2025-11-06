package orchescala
package api

import orchescala.api.InOutDocu.IN
import orchescala.domain.*
import orchescala.domain.InOutType.Bpmn
import sttp.tapir.EndpointIO.Example

trait TapirApiCreator extends AbstractApiCreator:

  protected def create(apiDoc: ApiDoc): Seq[PublicEndpoint[?, Unit, ?, Any]] =
    println(s"Start API: ${apiDoc.apis.size} top level APIs")
    apiDoc.apis.flatMap {
      case groupedApi: GroupedApi => groupedApi.create()
      case cApi: CApi             => throw IllegalArgumentException(
          s"Sorry, the top level must be a GroupedApi (Group or Process)!\n - Not ${cApi.getClass}"
        )
    }
  end create

  extension (groupedApi: GroupedApi)
    def create(): Seq[PublicEndpoint[?, Unit, ?, Any]] =
      println(s"Start Grouped API: ${groupedApi.name}")
      groupedApi match
        case pa: ProcessApi[?, ?, ?] =>
          pa.createEndpoint(pa.id, false, pa.additionalDescr) ++
            pa.createInitEndpoint(pa.id) ++
            pa.apis.flatMap(_.create(pa.id, false))
        case _: CApiGroup            =>
          groupedApi.apis.flatMap(_.create(groupedApi.name, true))
      end match
    end create

  end extension

  extension (cApi: CApi)
    def create(tag: String, tagIsFix: Boolean): Seq[PublicEndpoint[?, Unit, ?, Any]] =
      cApi match
        case da @ DecisionDmnApi(_, _, _, _)                                 =>
          da.createEndpoint(tag, tagIsFix, da.additionalDescr)
        case aa @ ActivityApi(_, _, _) if aa.inOutType == InOutType.UserTask =>
          aa.createEndpoint(
            tag,
            tagIsFix,
            inOutDocu = InOutDocu.OUT
          ) ++
            aa.createEndpoint(tag, tagIsFix, inOutDocu = InOutDocu.IN)
        case aa @ ActivityApi(_, _, _)                                       =>
          aa.createEndpoint(tag, tagIsFix)
        case pa @ ProcessApi(name, _, _, apis, _)
            if apis.isEmpty =>
          pa.createEndpoint(
            tag,
            tagIsFix,
            pa.additionalDescr
          )
        case spa: ExternalTaskApi[?, ?]                                      =>
          spa.createEndpoint(tag, tagIsFix, spa.additionalDescr)
        case ga                                                              =>
          throw IllegalArgumentException(
            s"Sorry, only one level of GroupedApi is allowed!\n - $ga"
          )

  end extension

  extension (processApi: ProcessApi[?, ?, ?])

    // creates the Init Worker Endpoint - each Process has one (not for GenericService)
    def createInitEndpoint(tagFull: String): Seq[PublicEndpoint[?, Unit, ?, Any]] =
      if hasInitIn then
        val eTag = shortenTag(tagFull)
        Seq(
          endpoint
            .name("Init Worker")
            .tag(eTag)
            .in("worker" / processApi.id)
            .summary("Init Worker")
            .description(
              s"""|${processApi.inOut.initInDescr.mkString}
                  |<details>
                  |<summary><b>General Information</b></summary>
                  |
                  |The Init Worker has the following responsibilities:
                  |
                  |  - Validates the Process Input (`In`). -> by Orchescala
                  |  - Maps the Configuration to Process Variables (`InConfig`). -> by Orchescala
                  |  - Custom validation the Process Input (`In`, e.g. combining 2 variables). -> Process Specific
                  |  - Initializes the default Variables with `In` as input (see _Process_ description) and `InitIn` as output. -> Process Specific
                  |
                  |The Input is the same as the `In` object of the _Process_.
                  |
                  |`NoInput` means there is no initialization needed.
                  |</details>
                  |""".stripMargin
            )
            .out(processApi.toInitIn)
            .post
        ) // renders `In` as input:
          .map(ep => processApi.toInput.map(ep.in).getOrElse(ep))
      else
        Seq.empty

    private def hasInitIn: Boolean =
      processApi.inOut.initIn match
        case _: NoOutput                                     =>
          false
        case i if i.getClass == processApi.inOut.in.getClass =>
          false
        case _                                               =>
          true
    end hasInitIn

    private def toInitIn: EndpointOutput[?] =
      processApi.initInMapper
        .examples(
          List(
            Example(
              processApi.inOut.initIn,
              Some("InitIn"),
              None
            )
          )
        )
  end extension
  extension (inOutApi: InOutApi[?, ?])

    def createEndpoint(
        tagFull: String,
        tagIsFix: Boolean,
        additionalDescr: Option[String] = None,
        inOutDocu: InOutDocu = InOutDocu.BOTH
    ): Seq[PublicEndpoint[?, Unit, ?, Any]] =
      val eTag         = if tagIsFix then tagFull else shortenTag(tagFull)
      println(s"createEndpoint: $tagIsFix $tagFull >> $eTag")
      val endpointName =
        (if inOutApi.name == tagFull then "Process" else inOutApi.endpointName(inOutDocu))
      println(s"Endpoint: $endpointName")
      val description  = inOutApi.apiDescription(apiConfig.companyName) +
        additionalDescr.getOrElse("") +
        generalInformation(inOutDocu)
      Seq(
        endpoint
          .name(endpointName)
          .tag(eTag)
          .in(endpointPath(inOutDocu))
          .summary(endpointName)
          .description(description)
      ).map: ep =>
        if inOutDocu == InOutDocu.OUT && inOutApi.inOutType == InOutType.UserTask
        then ep.get // UserTask variables
        else ep.post
      .map: ep =>
        inOutDocu match
          case InOutDocu.IN   => // UserTask complete
            inOutApi.toInputForUserTask.map(ep.in).getOrElse(ep)
          case InOutDocu.OUT  => // UserTask variables
            inOutApi.toOutputForUserTask.map(ep.out).getOrElse(ep)
          case InOutDocu.BOTH =>
            val inEp = inOutApi.toInput.map(ep.in).getOrElse(ep)
            inOutApi.toOutput.map(inEp.out).getOrElse(inEp)

    end createEndpoint

    def endpointPath(inOutDoc: InOutDocu) =
      val id = inOutApi.id
      inOutApi.inOutType match
        case InOutType.Bpmn                                 =>
          "process" / id / "async" / tenantIdQuery / businessKeyQuery
        case InOutType.Worker                               =>
          "worker" / id
        case InOutType.UserTask if inOutDoc == InOutDocu.IN => // complete
          "process" / path[String](
            "processInstanceId"
          ).default("{{processInstanceId}}") / "userTask" / id / path[String](
            "userTaskInstanceId"
          ).default("{{userTaskInstanceId}}") / "complete"
        case InOutType.UserTask                             => // variables
          "process" / path[String](
            "processInstanceId"
          ).default(
            "{{processInstanceId}}"
          ) / "userTask" / id / "variables" / variableFilterQuery / timeoutInSecQuery
        case InOutType.Signal                               =>
          "signal" / id / tenantIdQuery
        case InOutType.Message                              =>
          "message" / id
        case InOutType.Timer                                =>
          "timer" / id / "NOT_IMPLEMENTED"
        case InOutType.Dmn                                  =>
          "dmn" / id / "NOT_IMPLEMENTED"
      end match
    end endpointPath

    def generalInformation(inOutDoc: InOutDocu) =
      val info =
        inOutApi.inOutType match
          case InOutType.Bpmn                                 =>
            """
              |This describes the <b>Input</b> and the <b>Output</b> of the Process.
              |
              |Be aware that running this request with Postman,
              |you will not get the <b>Output</b> but the <i>processInstanceId</i>, as starting a process is asynchronous.
              |
              |Example Output:
              |```json
              |{
              |"processInstanceId": "f150c3f1-13f5-11ec-936e-0242ac1d0007",
              |"businessKey": "ORDER-2025-12345",
              |"status": "Active",
              |"engineType": "C7"
              |}
              |```
              |""".stripMargin
          case InOutType.Worker                               =>
            """
              |This describes the <b>Input</b> and the <b>Output</b> of the Worker.
              |
              |Running this request with Postman, it will run the Worker directly, no Process will be started.
              |""".stripMargin
          case InOutType.UserTask if inOutDoc == InOutDocu.IN => // complete
            """
              |A <b>UserTask</b> consists of two steps (variables and complete).
              |This is the <b>second step</b>:
              |
              |2. Complete the UserTask
              |
              |The <b>Input</b> are the Variables you want to set when completing the task.
              |
              |""".stripMargin
          case InOutType.UserTask                             => // variables
            """
              |A <b>UserTask</b> consists of two steps (variables and complete).
              |This is the <b>first step</b>:
              |
              |1. Wait for the UserTask and get then the Variables.
              |
              |The <b>Output</b> are the Variables you want for your UserTask Form.
              |
              |""".stripMargin
          case InOutType.Signal                               =>
            """Send a Signal to the Process.
              |Process is waiting at a Signal Event, or has the possibility to interact with a Signal,
              |e.g. in a Boundary Event.""".stripMargin
          case InOutType.Message                              =>
            """Send a Message to the Process.
              |Process is waiting at a Message Event, or has the possibility to interact with a Message,
              |e.g. in a Boundary Event.
              |""".stripMargin
          case InOutType.Timer                                =>
            """You can execute an intermediate timer event immediately.
              |
              |<b>NOT IMPLEMENTED in Gateway API!</b>
              |
              |This is done via the Job Execution API which is not part of Camunda 8!.""".stripMargin
          case InOutType.Dmn                                  =>
            """You can emulate a DMN.
              |
              |<b>NOT IMPLEMENTED in Gateway API!</b>
              |
              |You can use the DMN Tester to test your DMNs.
              |
              |This is done via the DMN API which is not part of Camunda 8!
              |""".stripMargin
        end match
      end info

      s"""<p/>
         |<details>
         |<summary><b><i>General Information</i></b></summary>
         |<p>
         |$info
         |</p>
         |</details>""".stripMargin
    end generalInformation

    private def toInput: Option[EndpointInput[?]] =
      inOutApi.inOut.in match
        case _: NoInput =>
          None
        case _          =>
          inputEndpoint(inOutApi)

    private def toInputForUserTask: Option[EndpointInput[?]] =
      inOutApi.inOut.out match
        case _: NoOutput =>
          None
        case _           =>
          outputEndpoint(inOutApi)

    private def toOutput: Option[EndpointOutput[?]] =
      inOutApi.inOut.out match
        case _: NoOutput =>
          None
        case _           =>
          outputEndpoint(inOutApi)

    private def toOutputForUserTask: Option[EndpointOutput[?]] =
      inOutApi.inOut.in match
        case _: NoInput =>
          None
        case _          =>
          inputEndpoint(inOutApi)

  end extension

  private def inputEndpoint(inOutApi: InOutApi[?, ?]) =
    Some(
      inOutApi.inMapper
        .examples(inOutApi.apiExamples.inputExamples.fetchExamples.map {
          case InOutExample(label, ex) =>
            Example(
              ex,
              Some(label),
              None
            )
        }.toList)
    )

  private def outputEndpoint(inOutApi: InOutApi[?, ?]) =
    Some(
      inOutApi.outMapper
        .examples(inOutApi.apiExamples.outputExamples.fetchExamples.map {
          case InOutExample(label, ex) =>
            Example(
              ex,
              Some(label),
              None
            )
        }.toList)
    )

  private lazy val tenantIdQuery       = query[String]("tenantId").default(
    "{{tenantId}}"
  ).description("If you have a multi tenant setup, you must specify the Tenant ID.")
  private lazy val businessKeyQuery    = query[String]("businessKey").default(
    "From Test Client"
  ).description("Business Key, be aware that in Camunda 8 this is an additional process variable.")
  private lazy val variableFilterQuery = query[String](
    "variableFilter"
  ).description("A comma-separated String of variable names. E.g. `name,firstName`")
  private lazy val timeoutInSecQuery   = query[Int]("timeoutInSec").example(10).description(
    "The maximum number of seconds to wait for the user task to become active. If not provided, it will wait 10 seconds."
  )

  extension (pa: ProcessApi[?, ?, ?] | ExternalTaskApi[?, ?])
    def processName: String =
      pa.inOut.in match
        case gs: GenericServiceIn =>
          gs.serviceName
        case _                    => pa.id

    def additionalDescr: Option[String] =
      if apiConfig.projectsConfig.isConfigured then
        val usedByDescr = UsedByReferenceCreator(processName).create()
        val usesDescr   = UsesReferenceCreator(processName).create()
        Some(s"\n\n${usedByDescr.mkString}${usesDescr.mkString}")
      else None
  end extension

  extension (dmn: DecisionDmnApi[?, ?])
    def additionalDescr: Option[String] =
      if apiConfig.projectsConfig.isConfigured then
        val usedByDescr = UsedByReferenceCreator(dmn.id).create()
        Some(s"\n\n${usedByDescr.mkString}")
      else None
  end extension

end TapirApiCreator
