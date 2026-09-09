package orchescala.engine.services

import coursierapi.{Dependency, Fetch, MavenRepository}
import orchescala.engine.domain.*
import zio.{IO, ZIO}

import java.net.URI
import java.nio.file.{FileSystems, Files, Path, Paths}
import scala.jdk.CollectionConverters.*

class RepositoryManifestResolver(
    basePath: String = "deployments",
    fallbackToRoot: Boolean = false,
    repositories: Seq[URI] = RepositoryManifestResolver.defaultRepositories
) extends ManifestResolver:

  override def resolve(entry: DeploymentEntry): IO[EngineError, Seq[DeploymentResource]] =
    if repositories.isEmpty then
      ZIO.logWarning(s"No deployment repositories configured for ${entry.deploymentName}") *>
        ZIO.succeed(Seq.empty)
    else
      for
        _ <- ZIO.logDebug(
               s"Resolving Maven artifact ${entry.company}:${entry.project}:${entry.version} with Coursier from repositories=${repositories.mkString(", ")}"
             )
        artifact <- fetchArtifact(entry)
        _        <- ZIO.logDebug(s"Coursier resolved ${entry.deploymentName} to $artifact")
        resources <- readJar(artifact, entry)
        _         <- ZIO.logDebug(s"Resolved ${resources.size} resource(s) from $artifact")
      yield resources
  end resolve

  private def fetchArtifact(entry: DeploymentEntry): IO[EngineError, Path] =
    ZIO.attemptBlocking:
      val dependency = Dependency
        .of(entry.company, entry.project, entry.version)
        .withTransitive(false)
      val fetch = Fetch.create().addDependencies(dependency)
      repositories.foreach: repository =>
        fetch.addRepositories(MavenRepository.of(repository.toString.stripSuffix("/")))
      val jars = fetch.fetch().asScala
        .map(_.toPath)
        .filter(path => path.getFileName.toString.endsWith(".jar"))
        .toSeq
      jars match
        case Seq(artifact) => artifact
        case Seq()         =>
          throw RuntimeException(s"Coursier returned no JAR for ${entry.company}:${entry.project}:${entry.version}")
        case artifacts     =>
          throw RuntimeException(
            s"Coursier returned multiple JARs for ${entry.company}:${entry.project}:${entry.version}: ${artifacts.mkString(", ")}"
          )
    .mapError: err =>
      EngineError.ProcessError(
        s"Problem resolving Maven artifact ${entry.company}:${entry.project}:${entry.version} with Coursier: ${err.getMessage}"
      )

  private def readJar(
      artifact: Path,
      entry: DeploymentEntry
  ): IO[EngineError, Seq[DeploymentResource]] =
    ZIO.attemptBlocking:
      val jarFsUri = URI.create(s"jar:${artifact.toUri}!/")
      val fs       = FileSystems.newFileSystem(jarFsUri, java.util.Collections.emptyMap())
      try
        val candidates   = candidatePrefixes(entry).map(p => fs.getPath(p.stripPrefix("/")))
        val chosenPrefix = candidates.find(p => Files.exists(p) && Files.isDirectory(p))
        val rootPath     = fs.getPath(basePath.stripSuffix("/").stripPrefix("/"))
        val files = chosenPrefix match
          case Some(prefix) => listFilesRecursive(prefix)
          case None if fallbackToRoot && Files.exists(rootPath) && Files.isDirectory(rootPath) =>
            listFilesRecursive(rootPath)
          case _ => Seq.empty

        files.map: path =>
          DeploymentResource(
            name = path.getFileName.toString,
            content = Files.readAllBytes(path),
            resourceType = resourceTypeForName(path.getFileName.toString)
          )
      finally fs.close()
    .mapError: err =>
      EngineError.ProcessError(
        s"Problem reading artifact $artifact for ${entry.deploymentName}: $err"
      )

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

  private def listFilesRecursive(path: Path): Seq[Path] =
    val stream = Files.walk(path)
    try
      stream.iterator().asScala
        .filter(p => Files.isRegularFile(p))
        .toSeq
    finally stream.close()

  private def resourceTypeForName(name: String): DeploymentResourceType =
    name.toLowerCase.split('.').lastOption match
      case Some("bpmn") => DeploymentResourceType.Bpmn
      case Some("dmn")  => DeploymentResourceType.Dmn
      case Some("form") => DeploymentResourceType.Form
      case Some(ext) if Set("js", "groovy", "py", "scala").contains(ext) =>
        DeploymentResourceType.Script
      case _ => DeploymentResourceType.Bpmn
end RepositoryManifestResolver

object RepositoryManifestResolver:
  lazy val defaultRepositories: Seq[URI] =
    Seq(
      Paths.get(System.getProperty("user.home"), ".m2", "repository").toUri,
      URI.create("https://repo1.maven.org/maven2")
    )
end RepositoryManifestResolver
