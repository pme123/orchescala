package orchescala.engine.services

import orchescala.engine.domain.*
import zio.{IO, ZIO}

import java.io.{ByteArrayOutputStream, InputStream}
import java.net.JarURLConnection
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
end ManifestResolver

class ClasspathManifestResolver(basePath: String = "deployments") extends ManifestResolver:

  override def resolve(entry: DeploymentEntry): IO[EngineError, Seq[DeploymentResource]] =
    val prefix = s"${basePath.stripSuffix("/")}/${entry.company}/${entry.project}/${entry.version}"
    for
      resourceNames <- listClasspathResources(prefix)
      resources   <- ZIO.foreach(resourceNames): name =>
                         loadResource(s"$prefix/$name").map: bytes =>
                           DeploymentResource(
                             name = name,
                             content = bytes,
                             resourceType = resourceTypeForName(name)
                           )
    yield resources
  end resolve

  private def listClasspathResources(prefix: String): IO[EngineError, Seq[String]] =
    ZIO.attempt:
      Option(getClass.getClassLoader.getResource(prefix.stripSuffix("/"))) match
        case None => Seq.empty
        case Some(resourceUrl) =>
          resourceUrl.openConnection() match
            case jarConnection: JarURLConnection =>
              val entryPrefix = jarConnection.getEntryName.stripSuffix("/") + "/"
              jarConnection.getJarFile.entries.asScala
                .map(_.getName)
                .filter(_.startsWith(entryPrefix))
                .map(_.stripPrefix(entryPrefix))
                .filter(_.nonEmpty)
                .filterNot(_.endsWith("/"))
                .toSeq

            case _ if resourceUrl.getProtocol == "file" =>
              val directoryPath = Paths.get(resourceUrl.toURI)
              if Files.isDirectory(directoryPath) then
                listFilesRecursive(directoryPath)
                  .map(directoryPath.relativize(_).toString)
                  .filterNot(_.isEmpty)
              else Seq.empty

            case _ => Seq.empty
    .mapError: err =>
      EngineError.ProcessError(s"Problem resolving manifest resources under '$prefix': $err")

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
