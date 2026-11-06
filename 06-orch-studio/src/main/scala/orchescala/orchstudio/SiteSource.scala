package orchescala.orchstudio

import java.net.JarURLConnection
import java.nio.file.{Files, Paths}
import scala.util.{Try, Using}

/** Where files of the documentation site come from. `rel` is a path relative to the site root
  * (`spec/index.html`), already checked by [[Site]]: no `..`, no empty segments.
  */
trait SiteSource:
  def read(rel: String): Option[Array[Byte]]
  def exists(rel: String): Boolean = read(rel).isDefined

object SiteSource:

  /** A folder, e.g. the company's assembled site `00-docs/site` while developing. */
  final case class Folder(root: os.Path) extends SiteSource:
    private def file(rel: String): Option[os.Path] =
      Try(root / os.RelPath(rel)).toOption.filter(f => f.startsWith(root) && os.isFile(f))
    def read(rel: String): Option[Array[Byte]] = file(rel).map(os.read.bytes)
    override def exists(rel: String): Boolean  = file(rel).isDefined

  /** Files below `prefix` on the classpath - the company's site in its studio (`site/`). With
    * `only`, just these files (a jar cannot be listed - the apps come with an index, `files.txt`).
    */
  final case class Classpath(
      prefix: String,
      only: Option[Set[String]] = None,
      loader: ClassLoader = getClass.getClassLoader
  ) extends SiteSource:
    private def resource(rel: String): Option[java.net.URL] =
      Option.when(only.forall(_.contains(rel)))(rel)
        .flatMap(r => Option(loader.getResource(prefix + r)))
        .filter(isRegularFile)
    def read(rel: String): Option[Array[Byte]] =
      resource(rel).flatMap(url => Try(Using.resource(url.openStream())(_.readAllBytes())).toOption)
    override def exists(rel: String): Boolean = resource(rel).isDefined

  /** Files given in memory - e.g. `spec/folder.json`, the company folder orch-spec names on its start. */
  final case class Memory(files: Map[String, Array[Byte]]) extends SiteSource:
    def read(rel: String): Option[Array[Byte]] = files.get(rel)

  /** orch-doc, orch-spec and orch-ops as the orchescala-orch-doc jar brings them (`orch-doc-site/`,
    * listed in its `files.txt`). None without the jar.
    */
  def orchDocApps(loader: ClassLoader = getClass.getClassLoader): Option[Classpath] =
    Option(loader.getResourceAsStream(s"$appsPrefix/files.txt"))
      .map(in => Using.resource(in)(s => String(s.readAllBytes(), "UTF-8")))
      .map(_.linesIterator.map(_.trim).filter(_.nonEmpty).filterNot(isCompanyData).toSet)
      .map(files => Classpath(s"$appsPrefix/", Some(files), loader))

  val appsPrefix = "orch-doc-site"

  /** Data of the company, not of the apps - never from the jar, even if a build put one there (a
    * local build of Orchescala copies orch-spec's `public/catalog.generated.json`, the catalog of
    * whatever the developer worked on last). Comes from the company's documentation or not at all.
    */
  private[orchstudio] def isCompanyData(rel: String): Boolean =
    rel.endsWith(".generated.json") || rel.endsWith("/folder.json")

  /** The company folders for orch-spec and orch-ops (`spec/folder.json`, `ops/folder.json`) - the apps
    * show them on their start screen, as the local preview of `prepareDocs` does. Only existing folders.
    */
  def folderHints(folders: Seq[(String, os.Path)]): Memory =
    Memory(folders.collect:
      case (app, dir) if os.isDir(dir) =>
        val path = dir.toString.replace("\\", "\\\\").replace("\"", "\\\"")
        s"$app/folder.json" -> s"""{"path":"$path"}""".getBytes("UTF-8")
    .toMap)

  // a directory on the classpath is no file - in a folder it would be read as a listing
  private def isRegularFile(url: java.net.URL): Boolean =
    url.getProtocol match
      case "file" => Try(Files.isRegularFile(Paths.get(url.toURI))).getOrElse(false)
      case "jar"  =>
        Try(url.openConnection().asInstanceOf[JarURLConnection].getJarEntry)
          .toOption.flatMap(Option(_)).exists(!_.isDirectory)
      case _      => true

end SiteSource
