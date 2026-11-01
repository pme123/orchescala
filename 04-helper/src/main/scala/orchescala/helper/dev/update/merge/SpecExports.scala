package orchescala.helper.dev.update.merge

import scala.util.Try

/** The export of a spec folder (`tools/spec2export.ts` of Orch Spec, format v1):
  * the processes and what could not be exported.
  */
case class SpecExport(processes: Seq[ProcessExport], issues: Seq[String] = Seq.empty)

object SpecExport:
  val empty: SpecExport = SpecExport(Seq.empty)

  /** The JSON of spec2export - an entry of a kind this version does not know (the service
    * collections, payload v2) is an issue, not an error.
    */
  def fromJson(text: String): SpecExport =
    val cursor = io.circe.parser.parse(text).fold(e => throw IllegalArgumentException(e.getMessage), _.hcursor)
    cursor.get[Int]("v") match
      case Right(1) =>
        val entries = cursor.downField("entries").values.toSeq.flatten.map(_.hcursor)
        val (processes, other) = entries.partition(_.get[String]("kind").contains("process"))
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
            s"${e.get[String]("slug").getOrElse("?")}: kind ${e.get[String]("kind").getOrElse("?")} is not known to this version of the helper - skipped."
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

  def hasNode: Boolean =
    Try(os.proc("node", "--version").call(check = false, stderr = os.Pipe).exitCode == 0).getOrElse(false)

  def exportOf(specDir: os.Path): SpecExport =
    if !hasNode then
      throw IllegalStateException("The merge from Orch Spec needs Node.js (node) - install it and run again.")
    val dir    = os.temp.dir(prefix = "orch-spec-tools")
    val script = dir / tool
    os.write(script, os.read.bytes(os.resource / "orch-doc-tools" / tool))
    try
      val r = os.proc("node", script.toString, specDir.toString).call(check = false, stderr = os.Pipe)
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

  /** The folder with the spec of the source - `None` if there is none (no spec in the commit,
    * `Empty`). A commit is extracted into a temporary folder.
    */
  def folder(project: os.Path, source: SpecSource): Option[os.Path] =
    source match
      case SpecSource.Empty       => None
      case SpecSource.Dir(path)   => Option.when(os.isDir(path))(path)
      case SpecSource.GitRev(rev) => fromGit(project, rev)

  /** `spec/` of the project in a commit - `git archive <rev>:./spec`, relative to the project
    * (it may be a folder in the repository). None if the commit has no spec.
    */
  private def fromGit(project: os.Path, rev: String): Option[os.Path] =
    val archive = os.proc("git", "archive", "--format=tar", s"$rev:./${specDir}")
      .call(cwd = project, check = false, stderr = os.Pipe)
    if archive.exitCode != 0 then None
    else
      val dir = os.temp.dir(prefix = "orch-spec-")
      os.proc("tar", "-x", "-C", dir.toString).call(stdin = archive.out.bytes, stderr = os.Pipe)
      Some(dir)
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
