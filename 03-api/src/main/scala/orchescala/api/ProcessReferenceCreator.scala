package orchescala.api

import java.io.StringReader
import scala.collection.concurrent.TrieMap
import scala.xml.XML
import orchescala.domain.{InOutType, shortenName}

/** Checks all BPMNs if a process is used in another process. As result a list is created that can
  * be included in the Documentation.
  */
trait ProcessReferenceCreator extends WorkerReferenceCreator:

  println(s"ProcessReferenceCreator: ${getClass.getName}")
  protected def projectName: String =
    getClass.getName.split('.').takeWhile(_ != "api").mkString("-")

  protected def apiConfig: ApiConfig

  protected def refIdentShort(refIdent: String): String                      =
    apiConfig.refIdentShort(refIdent)
  protected def refIdentShort(refIdent: String, projectName: String): String =
    apiConfig.refIdentShort(refIdent, projectName)

  protected def gitBasePath: os.Path                   = apiConfig.tempGitDir
  protected def docProjectUrl(project: String): String =
    val companyName = project.split("-").head
    apiConfig.docBaseUrl.map(u => s"$u/site/$companyName/$project").getOrElse("NOT_SET")

  // the BPMNs are the same for all ApiCreators of a run - so they are only read once
  lazy val allBpmns: Seq[(String, Seq[(os.Path, String)])] =
    ProcessReferenceCreator.allBpmns(cacheKey):
      println(s"BPMN Reference Base Directory: $gitBasePath")
      projectConfigs.map: pc =>
        val absBpmnPath = pc.absBpmnPath(gitBasePath)
        val paths       =
          if os.exists(absBpmnPath) then
            os.walk(absBpmnPath)
          else
            println(s"THIS PATH DOES NOT EXIST: $absBpmnPath")
            Seq.empty
        println(s"Get BPMNs in ${pc.name}")
        pc.name -> paths
          .filterNot(
            _.toString.contains("/target")
          ) // TODO filter all Camunda 8 BPMNs - NOT SUPPORTED YET
          .filterNot(_.toString.contains("/camunda8"))
          .filter(_.toString.endsWith(".bpmn"))
          .map: bpmnPath =>
            println(s"- ${bpmnPath.last}")
            bpmnPath -> os.read(bpmnPath)
  end allBpmns

  case class UsedByReferenceCreator(refId: String):

    def create(): String =
      val refs   = (findUsagesInBpmn() ++ findUsagesInWorkers())
        .distinct
        .groupBy(_._1)
        .toSeq
        .sortBy(_._1)
      val refDoc = refs
        .map { case k -> usages =>
          s"""_${k}_
             |${usages.map(_._2).distinct.sorted.mkString("   - ", "\n   - ", "\n")}
             |""".stripMargin
        }
        .mkString("\n- ", "\n- ", "\n")
      if refDoc.trim.length == 1 then
        "\n**Used in no other Process.**\n"
      else
        s"""
           |<details>
           |<summary><b>${usedByTitle(refs.size)}</b></summary>
           |<p>
           |
           |$refDoc
           |
           |</p>
           |</details>
           |""".stripMargin
      end if
    end create

    /** The Workers this Worker is composed of (Constructor parameters). */
    private def findUsagesInWorkers(): Seq[(String, String)] =
      usedByWorkers(refId)
        .map(worker => worker.projectName -> worker.asString)

    private def findUsagesInBpmn(): Seq[(String, String)] =
      println(s"Find Used by References for $refId")
      allBpmns
        .flatMap { case (processName, paths) =>
          paths
            .filter { case _ -> c =>
              (c.contains(s":$refId\"") || c.contains(s"\"$refId\"")) &&
              !c.contains(s"id=\"$refId\"")
            }
            .map { pc =>
              // println(s"-> $processName ${pc._1} - ${pc._2}")
              docuPath(processName, pc._1, pc._2)
            }
        }
    end findUsagesInBpmn

    private def docuPath(
        projectName: String,
        path: os.Path,
        content: String
    ): (String, String) =
      val extractId =
        val pattern   = """<(bpmn:process|process)([^\/>]+)isExecutable="true"([^\/>]*>)""".r
        val idPattern = """[\s\S]*id="([^"]*)"[\s\S]*""".r
        pattern
          .findFirstIn(content)
          .map { l =>
            val idPattern(id) = l: @unchecked
            id
          }
          .getOrElse(s"Id not found in $path")
      end extractId

      val refId                  = refIdentShort(extractId, projectName)
      lazy val identShortProcess = shortenTag(extractId)
      val anchor                 = s"#tag/${identShortProcess.replace(" ", "-")}"
      projectName -> s"[${InOutType.Bpmn}: $refId](${docProjectUrl(projectName)}/OpenApi.html$anchor)"
    end docuPath

    private def usedByTitle(processCount: Int): String =
      s"Used in $processCount Project(s)"

  end UsedByReferenceCreator

  case class UsesReferenceCreator(processName: String):

    def create(): String =
      println(s"Uses for $processName")
      val refs   = (findUsesInBpmn() ++ findUsesInWorkers())
        .distinct
        .groupBy(_._1)
        .toSeq
        .sortBy(_._1)
      val refDoc = refs
        .map { case k -> uses =>
          println(s"- $k:\n -- ${uses.map(_._2).mkString("\n -- ")}")
          s"""_${k}_
             |${uses
              .map(_._2)
              .distinct
              .sorted
              .mkString("   - ", "\n   - ", "\n")}
             |""".stripMargin
        }
        .mkString("\n- ", "\n- ", "\n")
      if refDoc.trim.length == 1 then
        "\n**Uses no other Processes.**\n"
      else
        s"""
           |<details>
           |<summary><b>${usesTitle(refs.size)}</b></summary>
           |<p>
           |
           |$refDoc
           |</p>
           |</details>
           |""".stripMargin
      end if
    end create

    private def findUsesInBpmn(): Seq[(String, String)] =
      findBpmn(processName).toSeq
        .flatMap(extractUsesRefs)
        .map(ref => ref.project -> ref.asString)

    /** The Workers this Worker is composed of (Constructor parameters). */
    private def findUsesInWorkers(): Seq[(String, String)] =
      usesWorkers(processName)
        .map(worker => worker.projectName -> worker.asString)

    case class UsesRef(
        processRef: String,
        serviceName: Option[String] = None,
        refType: InOutType = InOutType.Bpmn
    ):
      lazy val processId            = processRef
      lazy val project              = apiConfig.projectsConfig.projectNameForRef(processRef)
      println(s"CHANGES $processRef -  $project")
      lazy val processIdent: String = serviceName.getOrElse(processId)
      lazy val identShort           = shortenName(processIdent)
      lazy val identShortProcess    = shortenTag(processIdent).replace(" ", "-")
      lazy val anchorOperation      = s"#operation/$refType:%20$identShort"
      lazy val anchorProcess        = s"#tag/${identShortProcess}"

      lazy val serviceStr: String =
        serviceName.map(_ => s" ($processId)").getOrElse("")

      lazy val asString: String =
        refType match
          case InOutType.Bpmn if serviceName.isEmpty =>
            s"_[$identShortProcess](${docProjectUrl(project)}/OpenApi.html$anchorProcess)_ $serviceStr"
          case _                                     =>
            s"_[$refType: $identShort](${docProjectUrl(project)}/OpenApi.html$anchorOperation)_ $serviceStr"
    end UsesRef

    private def extractUsesRefs(xmlStr: String) =
      val xml             = XML.load(new StringReader(xmlStr))
      val callActivities  = (xml \\ "callActivity")
        .map { ca =>
          val calledElement    = ca \@ "calledElement"
          val maybeServiceName = (ca \\ "in")
            .filter(_ \@ "target" == "serviceName")
            .map(_ \@ "sourceExpression")
            .headOption
          UsesRef(calledElement, maybeServiceName)
        }
      val externalWorkers = (xml \\ "serviceTask")
        //  .filter(_ \@ "topic" nonEmpty)
        .map { br =>
          val workerRef = br
            .attribute("http://camunda.org/schema/1.0/bpmn", "topic")
            .get
          UsesRef(workerRef.toString, refType = InOutType.Worker)
        }.filterNot(_.processRef == processName) // filter InitWorker

      val businessRuleTasks = (xml \\ "businessRuleTask")
        .map { br =>
          val decisionRef = br
            .attribute("http://camunda.org/schema/1.0/bpmn", "decisionRef")
            .get
          UsesRef(decisionRef.toString, refType = InOutType.Dmn)
        }

      callActivities ++ businessRuleTasks ++ externalWorkers
    end extractUsesRefs

    private def findBpmn(
        processName: String
    ): Option[String] =
      allBpmns.flatMap { case _ -> paths =>
        paths
          .filter { case _ -> content =>
            content.contains(s"id=\"$processName\"")
          }
          .map(_._2)
      }.headOption
    end findBpmn

    private def usesTitle(processCount: Int): String =
      s"Uses $processCount Project(s)"

  end UsesReferenceCreator
end ProcessReferenceCreator

object ProcessReferenceCreator:

  private lazy val allBpmnsCache = TrieMap[String, Seq[(String, Seq[(os.Path, String)])]]()

  private def allBpmns(cacheKey: String)(
      read: => Seq[(String, Seq[(os.Path, String)])]
  ): Seq[(String, Seq[(os.Path, String)])] =
    allBpmnsCache.getOrElseUpdate(cacheKey, read)

end ProcessReferenceCreator
