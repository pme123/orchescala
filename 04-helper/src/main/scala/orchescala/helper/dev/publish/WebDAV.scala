package orchescala.helper.dev.publish

import orchescala.api.ApiConfig
import orchescala.helper.util.PublishConfig
import com.github.sardine.{Sardine, SardineFactory}
import com.github.sardine.impl.SardineException
import orchescala.domain.BpmnProcessType

import java.nio.charset.StandardCharsets

abstract class WebDAV:
  def publishConfig: PublishConfig
  def apiConfig: ApiConfig
  val publishBaseUrl  = s"${publishConfig.documentationUrl}/site"
  val contentTypeHtml = "text/html"
  val contentTypeYaml = "text/yaml"

  protected def startSession =
    val sardine = SardineFactory.begin

    // set Credentials
    (for
      username <- sys.env.get(publishConfig.documentationEnvUsername)
      password <- sys.env.get(publishConfig.documentationEnvPassword)
    yield
      println(s"Set Credentials for $username (${publishConfig.documentationEnvUsername})")
      sardine.setCredentials(username, password)
    )
      .getOrElse(
        throw new IllegalArgumentException(
          s"System Environment Variables ${publishConfig.documentationEnvUsername} and/ or ${publishConfig.documentationEnvPassword} are not set."
        )
      )
    sardine
  end startSession

  // no explicit createDirectory for new folders - PUT alone creates missing ancestor
  // collections on this server; an explicit MKCOL right before the first PUT into it causes
  // a 409.
  protected def uploadDir(sardine: Sardine, dir: os.Path, url: String): Unit =
    os.list(dir).foreach:
      case f if os.isDir(f) =>
        uploadDir(sardine, f, s"$url/${f.last}")
      case f =>
        println(s"Uploading $url/${f.last}")
        sardine.put(s"$url/${f.last}", os.read.bytes(f))
  end uploadDir

  /** Deletes a collection if it exists - a missing one is fine (404). */
  protected def deleteIfExists(sardine: Sardine, url: String, what: String): Unit =
    try
      if !sardine.list(url).isEmpty then // sardine.exists does not work (is not allowed)
        println(s"Delete existing $what")
        sardine.delete(url)
    catch
      case ex: SardineException
          if ex.getMessage.contains("Unexpected response (404 Not Found)") =>
        println(s"$what does not exist yet.")
  end deleteIfExists
end WebDAV

case class ProjectWebDAV(projectName: String, apiConfig: ApiConfig, publishConfig: PublishConfig)
    extends WebDAV:

  val projectUrl = s"$publishBaseUrl/${apiConfig.companyName}/$projectName/"

  def upload(): Unit =
    println(s"Start $projectName: upload Documentation to ${publishConfig.documentationUrl}")
    val sardine = startSession
    try
      deleteIfExists(sardine, projectUrl, s"project $projectName")
      // create new
      sardine.createDirectory(projectUrl)
      // The project's own OpenApi.html / PostmanOpenApi.html as written by `./helper.scala update`
      // (orch-doc's single-file page from the orchescala-orch-doc jar). Publishing never builds
      // orch-doc - no checkout needed here.
      Seq("OpenApi.html", "PostmanOpenApi.html").foreach: name =>
        val local = os.pwd / "03-api" / name
        if os.exists(local) then
          sardine.put(s"$projectUrl/$name", os.read.bytes(local), contentTypeHtml)
        else
          println(s"No 03-api/$name in this project - run `./helper.scala update` first. Not uploaded.")
      sardine.put(s"$projectUrl/OpenApi.yml", openApiYml, contentTypeYaml)
      // the company gateway's variant - linked from "<Company> Postman Instructions"
      postmanOpenApiYml.foreach(yml =>
        sardine.put(s"$projectUrl/PostmanOpenApi.yml", yml, contentTypeYaml)
      )
      postmanApiYml.foreach(pApi =>
        sardine.put(
          s"$projectUrl/postmanCollection.json",
          pApi,
          contentTypeYaml
        )
      )
      // additional files
      val docDir = os.pwd / "doc"
      if docDir.toIO.exists() then
        sardine.createDirectory(s"$projectUrl/doc/")
        val docFiles = os.list(docDir)
        docFiles.foreach { f =>
          println(s"Uploading $projectUrl/doc/${f.toIO.getName}")
          sardine.put(
            s"$projectUrl/doc/${f.toIO.getName}",
            os.read.inputStream(f)
          )
        }
      end if
      // diagrams
      sardine.createDirectory(s"$projectUrl/diagrams/")
      BpmnProcessType.diagramPaths.foreach: diagramPath =>
        val diagramDir = os.pwd / diagramPath
        if os.exists(diagramDir) then
          val diagramFiles = os.list(diagramDir)
          diagramFiles
            .filter(p =>
              p.toString().endsWith(".bpmn") || p.toString().endsWith(".dmn")
            )
            .foreach { f =>
              println(s"Uploading $projectUrl/diagrams/${f.toIO.getName}")
              sardine.put(
                s"$projectUrl/diagrams/${f.toIO.getName}",
                os.read.inputStream(f)
              )
            }

          println(s"Finished $projectName: upload Documentation")
        else
          println(s"No Diagrams in this project: $diagramDir")
        end if
    finally sardine.shutdown()
    end try
  end upload

  private lazy val openApiYml    = os
    .read(apiConfig.openApiPath)
    .getBytes(StandardCharsets.UTF_8)
  // only projects generated with a company gateway config have (and link) it
  private lazy val postmanOpenApiYml: Option[Array[Byte]] =
    Option.when(apiConfig.companyPostmanInstructions.isDefined && os.exists(apiConfig.postmanOpenApiPath)):
      os.read(apiConfig.postmanOpenApiPath).getBytes(StandardCharsets.UTF_8)
  private lazy val postmanApiYml =
    val path = os.pwd / "postmanCollection.json"
    if path.toIO.exists() then
      Some(path.getInputStream)
    else None
  end postmanApiYml

end ProjectWebDAV

/** Uploads the documentation site (the orch-doc build in the company's `00-docs/site`) to
  * `/site`. /site is never deleted as a whole: the projects' own folders
  * (`/site/<company>/<project>/`, published by each project) and the classic sites of older
  * releases (`/site/<company>/<tag>/`) live there too. Only what the build fully regenerates -
  * `assets/` and `spec/` (hashed file names, old ones would pile up) - is replaced; everything
  * else is written over.
  */
case class SiteWebDAV(apiConfig: ApiConfig, publishConfig: PublishConfig) extends WebDAV:
  // trailing slash matters for MKCOL / DELETE on this WebDAV server
  val siteUrl = s"$publishBaseUrl/"

  def upload(localDir: os.Path): Unit =
    println(s"Start: upload documentation site $localDir to $siteUrl")
    val sardine = startSession
    try
      Seq("assets", "spec").foreach: dir =>
        if os.exists(localDir / dir) then
          deleteIfExists(sardine, s"$siteUrl$dir/", s"/site/$dir")
      // no explicit createDirectory - see uploadDir
      uploadDir(sardine, localDir, siteUrl.stripSuffix("/"))
      println(s"Finished: upload documentation site to $siteUrl")
    finally sardine.shutdown()
    end try
  end upload

end SiteWebDAV
