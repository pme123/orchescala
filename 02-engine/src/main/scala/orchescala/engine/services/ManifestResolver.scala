package orchescala.engine.services

import orchescala.engine.domain.*
import zio.{IO, ZIO}

import java.io.{ByteArrayOutputStream, InputStream}
import java.net.{JarURLConnection, URL}
import java.nio.file.{Files, Path, Paths}
import scala.jdk.CollectionConverters.*

trait ManifestResolver:
  def resolve(entry: DeploymentEntry): IO[EngineError, Seq[DeploymentResource]]
end ManifestResolver

object ManifestResolver:
  val unsupported: ManifestResolver = new ManifestResolver:
    override def resolve(entry: DeploymentEntry): IO[EngineError, Seq[DeploymentResource]] =
      ZIO.fail(
        EngineError.UnexpectedError(
          s"Manifest resolution is not supported for entry ${entry.deploymentName}"
        )
      )

  def firstNonEmpty(resolvers: Seq[ManifestResolver]): ManifestResolver =
    new ManifestResolver:
      override def resolve(entry: DeploymentEntry): IO[EngineError, Seq[DeploymentResource]] =
        ZIO
          .foldLeft(resolvers)(Option.empty[Seq[DeploymentResource]]):
            (found, resolver) =>
              found match
                case Some(resources) => ZIO.succeed(Some(resources))
                case None            =>
                  resolver.resolve(entry).either.map:
                    case Right(resources) if resources.nonEmpty => Some(resources)
                    case _                                      => None
          .map(_.getOrElse(Seq.empty))
end ManifestResolver

class ClasspathManifestResolver(
    basePath: String = "deployments",
    fallbackToRoot: Boolean = false
) extends ManifestResolver:

  override def resolve(entry: DeploymentEntry): IO[EngineError, Seq[DeploymentResource]] =
    val candidates = candidatePrefixes(entry)
    ZIO
      .foldLeft(candidates)(Option.empty[Seq[DeploymentResource]]):
        (found, prefix) =>
          found match
            case Some(resources) => ZIO.succeed(Some(resources))
            case None            =>
              for
                names <- listClasspathResources(prefix)
                resources <- names match
                  case Seq() => ZIO.succeed(None)
                  case _     =>
                    ZIO.logDebug(
                      s"Resolved ${names.size} resources for manifest entry ${entry.deploymentName} under '$prefix'"
                    ) *>
                      loadResources(prefix, names).map(Some(_))
              yield resources
      .map(_.getOrElse(Seq.empty))
  end resolve

  private def candidatePrefixes(entry: DeploymentEntry): Seq[String] =
    val bp = basePath.stripSuffix("/")
    val withVersion = Seq(
      s"$bp/${entry.company}/${entry.project}/${entry.version}",
      s"$bp/${entry.project}/${entry.version}"
    )
    val withoutVersion = Seq(
      s"$bp/${entry.company}/${entry.project}",
      s"$bp/${entry.project}"
    )
    val root = if fallbackToRoot then Seq(bp) else Seq.empty
    withVersion ++ withoutVersion ++ root

  private def loadResources(
      prefix: String,
      resourceNames: Seq[String]
  ): IO[EngineError, Seq[DeploymentResource]] =
    ZIO.foreach(resourceNames): name =>
      loadResource(s"$prefix/$name").map: bytes =>
        DeploymentResource(
          name = name,
          content = bytes,
          resourceType = resourceTypeForName(name)
        )

  private def listClasspathResources(prefix: String): IO[EngineError, Seq[String]] =
    ZIO.attempt:
      val urls  = getClass.getClassLoader.getResources(prefix.stripSuffix("/")).asScala.toSeq
      val names = urls.flatMap(listResourcesForUrl).distinct
      (urls, names)
    .tap:
      case (urls, names) =>
        ZIO.logDebug(s"Classpath prefix '$prefix': URLs=${urls.size}, resources=${names.size}")
    .map(_._2)
    .mapError: err =>
      EngineError.ProcessError(s"Problem resolving manifest resources under '$prefix': $err")

  private def listResourcesForUrl(url: URL): Seq[String] =
    url.openConnection() match
      case jarConnection: JarURLConnection =>
        val entryPrefix = jarConnection.getEntryName.stripSuffix("/") + "/"
        jarConnection.getJarFile.entries.asScala
          .map(_.getName)
          .filter(_.startsWith(entryPrefix))
          .map(_.stripPrefix(entryPrefix))
          .filter(_.nonEmpty)
          .filterNot(_.endsWith("/"))
          .toSeq

      case _ if url.getProtocol == "file" =>
        val directoryPath = Paths.get(url.toURI)
        if Files.isDirectory(directoryPath) then
          listFilesRecursive(directoryPath)
            .map(directoryPath.relativize(_).toString)
            .filterNot(_.isEmpty)
        else Seq.empty

      case _ => Seq.empty

  private def listFilesRecursive(path: Path): Seq[Path] =
    val stream = Files.walk(path)
    try
      stream.iterator().asScala
        .filter(p => Files.isRegularFile(p))
        .toSeq
    finally stream.close()

  private def loadResource(path: String): IO[EngineError, Array[Byte]] =
    ZIO.attempt:
      Option(getClass.getClassLoader.getResourceAsStream(path.stripPrefix("/"))) match
        case None => throw RuntimeException(s"Resource not found: $path")
        case Some(stream) =>
          try
            val buffer = new ByteArrayOutputStream()
            val data   = new Array[Byte](4096)
            var read   = 0
            while
              read = stream.read(data)
              read != -1
            do buffer.write(data, 0, read)
            buffer.toByteArray
          finally stream.close()
    .mapError: err =>
      EngineError.ProcessError(s"Problem loading resource '$path': $err")

  private def resourceTypeForName(name: String): DeploymentResourceType =
    name.toLowerCase.split('.').lastOption match
      case Some("bpmn") => DeploymentResourceType.Bpmn
      case Some("dmn")  => DeploymentResourceType.Dmn
      case Some("form") => DeploymentResourceType.Form
      case Some(ext) if Set("js", "groovy", "py", "scala").contains(ext) =>
        DeploymentResourceType.Script
      case _ => DeploymentResourceType.Bpmn
end ClasspathManifestResolver
