package orchescala.helper.dev.update.merge

import scala.util.Try
import scala.util.boundary
import scala.util.boundary.break
import scala.util.control.NonFatal

/** The export of a spec folder (`tools/spec2export.ts` of Orch Spec, format v1):
  * the processes, the services and what could not be exported.
  */
case class SpecExport(processes: Seq[ProcessExport], issues: Seq[String] = Seq.empty, services: Seq[ServicesExport] = Seq.empty):
  def entries: Seq[SpecEntry] = processes ++ services

object SpecExport:
  val empty: SpecExport = SpecExport(Seq.empty)

  /** The JSON of spec2export - an entry of a kind this version does not know is an issue, not
    * an error.
    */
  def fromJson(text: String): SpecExport =
    val cursor = io.circe.parser.parse(text).fold(e => throw IllegalArgumentException(e.getMessage), _.hcursor)
    cursor.get[Int]("v") match
      case Right(1) =>
        val entries = cursor.downField("entries").values.toSeq.flatten.map(_.hcursor)
        val serviceKinds       = Seq("serviceCollection", "serviceOrchestration")
        val (processes, rest)  = entries.partition(_.get[String]("kind").contains("process"))
        val (services, other)  = rest.partition(e => e.get[String]("kind").exists(serviceKinds.contains))
        SpecExport(
          processes.map: e =>
            ProcessExport(
              e.get[String]("slug").getOrElse(""),
              e.get[Option[String]]("bpmn").toOption.flatten,
              e.get[String]("scala").getOrElse(""),
              e.downField("dmns").values.toSeq.flatten.flatMap: d =>
                for
                  file <- d.hcursor.get[String]("file").toOption
                  xml  <- d.hcursor.get[String]("xml").toOption
                yield file -> xml
            ),
          cursor.downField("issues").values.toSeq.flatten.map: i =>
            s"${i.hcursor.get[String]("file").getOrElse("?")}: ${i.hcursor.get[String]("text").getOrElse("")}"
          ++ other.map: e =>
            s"${e.get[String]("slug").getOrElse("?")}: kind ${e.get[String]("kind").getOrElse("?")} is not known to this version of the helper - skipped.",
          services.map: e =>
            ServicesExport(e.get[String]("slug").getOrElse(""), e.get[String]("scala").getOrElse(""))
        )
      case other    =>
        throw IllegalArgumentException(
          s"Version ${other.getOrElse("?")} of the spec export is not known - update the orchescala helper."
        )
    end match
  end fromJson
end SpecExport

/** Gives the export of a spec folder. */
trait SpecExporter:
  def exportOf(specDir: os.Path): SpecExport

/** Orch Spec's own tool (`spec2export.js`, bundled into the orchescala-orch-doc jar as
  * `orch-doc-tools/`) run with Node.js - the same code as the export dialog.
  */
object NodeSpecExporter extends SpecExporter:

  val tool = "spec2export.js"

  /** Node.js is on the PATH - checked once per run of the helper; if the check itself fails (it
    * hangs, node cannot be started) it says why, so a missing Node.js is not the only hint.
    */
  lazy val hasNode: Boolean =
    Try(ExternalTool.call(Seq("node", "--version"), ExternalTool.probeTimeout).exitCode == 0)
      .recover:
        case NonFatal(e) =>
          println(Console.YELLOW + s"node --version failed: ${Option(e.getMessage).getOrElse(e.toString)}" + Console.RESET)
          false
      .get

  def exportOf(specDir: os.Path): SpecExport =
    if !hasNode then
      throw IllegalStateException("The merge from Orch Spec needs Node.js (node) - install it and run again.")
    val dir    = os.temp.dir(prefix = "orch-spec-tools")
    val script = dir / tool
    os.write(script, os.read.bytes(os.resource / "orch-doc-tools" / tool))
    try
      val r = ExternalTool.call(Seq("node", script.toString, specDir.toString), ExternalTool.nodeTimeout)
      if r.exitCode != 0 then
        throw IllegalStateException(s"$tool failed (exit code ${r.exitCode}): ${r.err.text().trim}")
      SpecExport.fromJson(r.out.text())
    finally os.remove.all(dir)
  end exportOf
end NodeSpecExporter

/** The spec folder of a source - read only. */
object SpecSources:

  /** The folder of the spec in a project. */
  val specDir: os.RelPath = os.rel / "spec"

  /** Why the folder is no spec folder of Orch Spec - None if it is one: it has a
    * `config/model.json` (in older folders `model.json`), `processes/` or `services/` (a project
    * with services only).
    */
  def whyNoSpecFolder(dir: os.Path): Option[String] =
    if !os.exists(dir) then Some(s"No spec folder $dir - it does not exist")
    else if !os.isDir(dir) then Some(s"$dir is no folder")
    else if !(Seq(dir / "config" / "model.json", dir / "model.json").exists(os.isFile)
        || Seq(dir / "processes", dir / "services").exists(os.isDir(_))) then
      Some(s"$dir is no spec folder of Orch Spec - it has no config/model.json, no processes/ and no services/")
    else None

  /** The folder with the spec of the source - `None` if there is none (no spec in the commit,
    * `Empty`). A commit is extracted into a temporary folder.
    */
  def folder(project: os.Path, source: SpecSource): Option[os.Path] =
    source match
      case SpecSource.Empty       => None
      case SpecSource.Dir(path)   => Option.when(os.isDir(path))(path)
      case SpecSource.GitRev(rev) => fromGit(project, rev)

  /** `spec/` of the project in a commit - `git archive <rev>:<path of the project>/spec`, run in
    * the root of the repository (in a subfolder git archive keeps only what lies below that
    * folder). None if there is no spec: no repository, no such commit, no spec in it - another
    * failure of git is an error. The temporary folder is removed again if the extraction fails.
    * @param extract the command that extracts the tar from stdin into the folder
    */
  private[merge] def fromGit(
      project: os.Path,
      rev: String,
      extract: os.Path => Seq[String] = dir => Seq("tar", "-x", "-C", dir.toString)
  ): Option[os.Path] =
    // git never asks for a credential: it fails at once instead of waiting for its timeout; and it
    // answers in English whatever the locale - "not a git repository" tells no repository from a failure
    val noPrompt           = Map("GIT_TERMINAL_PROMPT" -> "0", "LC_ALL" -> "C", "LANGUAGE" -> "C")
    def git(args: String*) = ExternalTool.call("git" +: args, ExternalTool.gitTimeout, cwd = project, env = noPrompt)
    // None only where git says there is no spec - any other failure (dubious ownership, a damaged
    // repository) is an error, not a first merge
    def orFail(r: os.CommandResult) = if r.exitCode != 0 then throw os.SubprocessException(r) else r
    boundary:
      // the path of the project in the repository (`projects/my-project/` - empty in its root)
      val root   = git("rev-parse", "--show-toplevel")
      if root.exitCode != 0 && root.err.text().contains("not a git repository") then break(None)
      val top    = os.Path(orFail(root).out.trim())
      val path   = s"${orFail(git("rev-parse", "--show-prefix")).out.trim()}$specDir"
      val spec   = s"$rev:$path"
      // --verify --quiet: exit code 1 - no such commit (none yet)
      val commit = git("rev-parse", "--verify", "--quiet", s"$rev^{commit}")
      if commit.exitCode == 1 then break(None)
      orFail(commit)
      // no spec/ in the commit: ls-tree lists nothing - by its output, not by a message
      if orFail(git("ls-tree", "--full-tree", "--name-only", rev, "--", path)).out.trim().isEmpty then break(None)
      val archive = orFail(ExternalTool.call(Seq("git", "archive", "--format=tar", spec), ExternalTool.gitTimeout, cwd = top, env = noPrompt))
      val dir     = os.temp.dir(prefix = "orch-spec-")
      var kept    = false
      // whatever ends it - an error, an interrupt (Ctrl-C) - the folder is removed unless it is the result
      try
        orFail(ExternalTool.call(extract(dir), ExternalTool.gitTimeout, stdin = archive.out.bytes))
        kept = os.list(dir).nonEmpty
        Option.when(kept)(dir)
      finally if !kept then os.remove.all(dir)
      end try
  end fromGit

  /** The files of a folder, relative to it - without hidden files. */
  def files(dir: os.Path): Map[os.RelPath, Array[Byte]] =
    if !os.isDir(dir) then Map.empty
    else
      os.walk(dir, skip = p => p.last.startsWith("."))
        .filter(os.isFile(_))
        .map(f => f.relativeTo(dir) -> os.read.bytes(f))
        .toMap

end SpecSources

/** Brings BPMN and DMN into the form of the Camunda Modeler before they are compared - the texts by a key. */
trait XmlFormatter:
  def format(texts: Map[String, String]): Map[String, String]

object XmlFormatter:
  /** Orch Spec's `modelerXml` with Node.js - without Node.js (or the tool) the texts stay as they are. */
  def default: XmlFormatter =
    if NodeXmlFormatter.available then NodeXmlFormatter else NoXmlFormatter

/** The texts as they are. */
object NoXmlFormatter extends XmlFormatter:
  def format(texts: Map[String, String]): Map[String, String] = texts

/** Orch Spec's own formatter (`xmlformat.js`, `modelerXml` in src/modelerXml.ts: the serializer of the
  * Camunda Modeler, bpmn-moddle / dmn-moddle) - all texts in one run.
  */
object NodeXmlFormatter extends XmlFormatter:

  val tool = "xmlformat.js"

  lazy val available: Boolean =
    NodeSpecExporter.hasNode && Try(os.read.bytes(os.resource / "orch-doc-tools" / tool)).isSuccess

  def format(texts: Map[String, String]): Map[String, String] =
    if texts.isEmpty then texts
    else
      val dir    = os.temp.dir(prefix = "orch-spec-tools")
      val script = dir / tool
      os.write(script, os.read.bytes(os.resource / "orch-doc-tools" / tool))
      try
        import io.circe.syntax.*
        val r = ExternalTool.call(Seq("node", script.toString, "--json"), ExternalTool.nodeTimeout, stdin = texts.asJson.noSpaces)
        if r.exitCode != 0 then
          throw IllegalStateException(s"$tool failed (exit code ${r.exitCode}): ${r.err.text().trim}")
        io.circe.parser.decode[Map[String, String]](r.out.text()).fold(e => throw IllegalStateException(e.getMessage), identity)
      finally os.remove.all(dir)
  end format
end NodeXmlFormatter
