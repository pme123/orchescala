package orchescala.helper.dev.publish

import orchescala.api.ApiConfig
import orchescala.helper.util.{Helpers, PublishConfig}
import com.github.sardine.{Sardine, SardineFactory}
import com.github.sardine.impl.SardineException
import orchescala.domain.BpmnProcessType

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import scala.jdk.CollectionConverters.CollectionHasAsScala

abstract class WebDAV:
  def publishConfig: PublishConfig
  def apiConfig: ApiConfig
  val publishBaseUrl  = s"${publishConfig.documentationUrl}/site"
  val contentTypeHtml = "text/html"
  val contentTypeYaml = "text/yaml"
  val contentTypeIcon = "image/x-icon"

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

  // no explicit createDirectory for new folders - like DocsWebDAV.uploadFiles below, PUT alone
  // creates missing ancestor collections on this server; an explicit MKCOL right before the
  // first PUT into it causes a 409 (seen with PreviewWebDAV's brand-new /preview path).
  protected def uploadDir(sardine: Sardine, dir: os.Path, url: String): Unit =
    os.list(dir).foreach:
      case f if os.isDir(f) =>
        uploadDir(sardine, f, s"$url/${f.last}")
      case f =>
        println(s"Uploading $url/${f.last}")
        sardine.put(s"$url/${f.last}", os.read.bytes(f))
  end uploadDir
end WebDAV

case class CatalogWebDAV(apiConfig: ApiConfig, publishConfig: PublishConfig) extends WebDAV:
  def upload(): Unit =
    println(s"Start: upload Home HTML to ${publishConfig.documentationUrl}")
    publishConfig.homeHtmlPath
      .map: homeHtmlPath =>
        println(
          s"Start $homeHtmlPath: upload Home HTML to ${publishConfig.documentationUrl}/index.html"
        )
        val sardine = startSession
        try
          sardine.delete(s"${publishConfig.documentationUrl}/favicon.ico")
          sardine.delete(s"${publishConfig.documentationUrl}/index.html")
          // create new
          sardine.put(
            s"${publishConfig.documentationUrl}/favicon.ico",
            os.read.inputStream(os.resource / "favicon.ico"),
            contentTypeIcon
          )
          sardine.put(
            s"${publishConfig.documentationUrl}/index.html",
            os.read.inputStream(homeHtmlPath),
            contentTypeHtml
          )
        finally sardine.shutdown()
        end try
      .getOrElse(println("No home page defined."))
  end upload

end CatalogWebDAV

case class ProjectWebDAV(projectName: String, apiConfig: ApiConfig, publishConfig: PublishConfig)
    extends WebDAV:

  val projectUrl        = s"$publishBaseUrl/${apiConfig.companyName}/$projectName/"
  val previewProjectUrl =
    s"${publishConfig.documentationUrl}/preview/${apiConfig.companyName}/$projectName/"

  def upload(): Unit =
    println(s"Start $projectName: upload Documentation to ${publishConfig.documentationUrl}")
    val sardine = startSession
    try
      // remove existing project if exists
      try
        val existingFiles = sardine.list(
          projectUrl
        ) // sardine.exists does not work (is not allowed)
        if !existingFiles.isEmpty then
          println("Delete existing")
          sardine.delete(projectUrl)
      catch
        case ex: SardineException
            if ex.getMessage.contains("Unexpected response (404 Not Found)") =>
          println(s"New Project will be created.")
      end try
      // create new
      sardine.createDirectory(projectUrl)
      publishConfig.apiDocPath match
        case Some(orchDocPath) =>
          // orch-doc's standalone API page (dist/api.html) replaces the static Redoc shell -
          // see orch-doc README "Standalone API page per project"
          val distDir = OrchDocBuilder(orchDocPath).build()
          sardine.put(
            s"$projectUrl/OpenApi.html",
            os.read.inputStream(distDir / "api.html"),
            contentTypeHtml
          )
          val assetsUrl = s"${projectUrl.stripSuffix("/")}/assets"
          // no explicit createDirectory - see uploadDir; assets/ is a brand-new path for
          // old-style projects that only ever had a static OpenApi.html before
          uploadDir(sardine, distDir / "assets", assetsUrl)
          val favicon   = distDir / "favicon.png"
          if os.exists(favicon) then
            sardine.put(s"$projectUrl/favicon.png", os.read.bytes(favicon))
        case None               =>
          sardine.put(s"$projectUrl/OpenApi.html", openApiHtml, contentTypeHtml)
      sardine.put(s"$projectUrl/OpenApi.yml", openApiYml, contentTypeYaml)
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

      mirrorToPreview(sardine)
    finally sardine.shutdown()
    end try
  end upload

  /** Mirrors OpenApi.yml + diagrams into /preview - the orch-doc app's in-app API view
    * (#/<company>/api/<project>) fetches these directly at runtime, independent of docs.json, so
    * a single project's own publish keeps its /preview page current without a full company-wide
    * previewDocs/publishDocs run. Best-effort: never fails the (production-critical) /site
    * upload above - /preview is still the experimental side of this.
    */
  private def mirrorToPreview(sardine: Sardine): Unit =
    try
      println(s"Mirroring OpenApi.yml + diagrams to $previewProjectUrl")
      sardine.put(s"$previewProjectUrl/OpenApi.yml", openApiYml, contentTypeYaml)
      BpmnProcessType.diagramPaths
        .map(os.pwd / _)
        .filter(os.exists)
        .flatMap(os.list)
        .filter(p => p.toString.endsWith(".bpmn") || p.toString.endsWith(".dmn"))
        .foreach: f =>
          sardine.put(s"$previewProjectUrl/diagrams/${f.last}", os.read.bytes(f))
    catch
      case ex: Throwable =>
        println(s"Mirroring to /preview failed (non-fatal): ${ex.getMessage}")
  end mirrorToPreview

  private lazy val openApiHtml   =
    os.read.inputStream(publishConfig.openApiHtmlPath)
  private lazy val openApiYml    = os
    .read(apiConfig.openApiPath)
    .getBytes(StandardCharsets.UTF_8)
  private lazy val postmanApiYml =
    val path = os.pwd / "postmanCollection.json"
    if path.toIO.exists() then
      Some(path.getInputStream)
    else None
  end postmanApiYml

end ProjectWebDAV

/** Uploads the orch-doc preview build under `/preview` - entirely separate from `/site` (see
  * DocsWebDAV), so the live, Laika-rendered site is never touched while the new one is tested.
  */
case class PreviewWebDAV(apiConfig: ApiConfig, publishConfig: PublishConfig) extends WebDAV:
  // trailing slash matters for MKCOL on this WebDAV server - matches ProjectWebDAV's projectUrl
  val previewUrl = s"${publishConfig.documentationUrl}/preview/"

  def upload(localDir: os.Path): Unit =
    println(s"Start: upload preview to $previewUrl")
    val sardine = startSession
    try
      try
        val existingFiles = sardine.list(previewUrl)
        if !existingFiles.isEmpty then
          println("Delete existing preview")
          sardine.delete(previewUrl)
      catch
        case ex: SardineException
            if ex.getMessage.contains("Unexpected response (404 Not Found)") =>
          println("/preview will be created.")
      end try
      // no explicit createDirectory - see uploadDir
      uploadDir(sardine, localDir, previewUrl.stripSuffix("/"))
      println(s"Finished: upload preview to $previewUrl")
    finally sardine.shutdown()
    end try
  end upload

end PreviewWebDAV

case class DocsWebDAV(apiConfig: ApiConfig, publishConfig: PublishConfig) extends WebDAV
    with Helpers:
  def upload(releaseTag: String): Unit =
    val sardine = startSession
    val docDir  = apiConfig.basePath / "site"
    val redirectIndex = apiConfig.basePath / "redirect.html"
    if docDir.toIO.exists() then
      try

        if os.exists(redirectIndex) then
          println(s"Replace redirect index.html in ${publishConfig.documentationUrl} with $redirectIndex")
          sardine.put(s"${publishConfig.documentationUrl}/index.html", os.read.bytes(redirectIndex))

        def uploadFiles(url: String, docFiles: Seq[os.Path]): Unit =
          docFiles.foreach {
            case f if f.toIO.isDirectory && f.toIO.exists() =>
              println(s"Create Directory $url/${f.toIO.getName}")
              // sardine.createDirectory(s"$url/${f.toIO.getName}")
              uploadFiles(s"$url/${f.toIO.getName}", os.list(f))
            case f if f.toIO.exists()                       =>
              println(s"Uploading $url/${f.toIO.getName}")
              sardine.put(s"$url/${f.toIO.getName}", os.read.bytes(f))
            case f                                          =>
              println(s"Not supported file: $f")
          }

        def addBaseFiles =
          // create top level files for versioned root pages / directories
          println(s"Create redirect of versioned: $releaseTag")
          val content =
            s"""<!DOCTYPE html>
               |<html lang="en-CH">
               |<head>
               |  <meta charset="utf-8">
               |  <meta name="viewport" content="width=device-width, initial-scale=1.0">
               |  <title>Redirecting to ${apiConfig.companyName} Documentation…</title>
               |  <meta http-equiv="refresh" content="0; url=./$releaseTag/">
               |  <link rel="canonical" href="./$releaseTag/">
               |  <script>
               |    window.location.replace("./$releaseTag/");
               |  </script>
               |</head>
               |<body>
               |  <p>Redirecting to the ${apiConfig.companyName} documentation… <a href="./$releaseTag/">Open documentation</a></p>
               |</body>
               |</html>""".stripMargin
          os.write.over((docDir / apiConfig.companyName / "index.html"), content)
        end addBaseFiles

        addBaseFiles
        if sardine.exists(s"$publishBaseUrl/index.html") then
          uploadFiles(s"$publishBaseUrl/${apiConfig.companyName}", os.list(docDir / apiConfig.companyName))
        else
          uploadFiles(s"$publishBaseUrl", os.list(docDir))

        println(s"Finished upload Documentation")
      catch
        case ex: SardineException
            if ex.getMessage == "Unexpected response (404 Not Found)" =>
          println(s"New Project will be created.")
      finally
        sardine.shutdown()
      end try
    else
      throw new IllegalStateException(
        "This Task is only possible for company-docs project."
      )
    end if
  end upload

end DocsWebDAV
