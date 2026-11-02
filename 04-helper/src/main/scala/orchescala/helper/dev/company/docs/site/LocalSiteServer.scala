package orchescala.helper.dev.company.docs.site

import com.sun.net.httpserver.{HttpExchange, HttpServer}

import io.circe.Json

import java.io.IOException
import java.net.InetSocketAddress
import scala.util.Try
import scala.util.control.NonFatal

/** Serves an assembled site locally - the preview at the end of `prepareDocs`. Static files
  * only, `/` -> `index.html`; runs until the JVM is stopped (Ctrl-C).
  */
object LocalSiteServer:

  private val contentTypes = Map(
    "html" -> "text/html; charset=utf-8", "js" -> "text/javascript", "css" -> "text/css",
    "json" -> "application/json", "yml" -> "text/yaml", "md" -> "text/markdown; charset=utf-8",
    "png" -> "image/png", "svg" -> "image/svg+xml", "ico" -> "image/x-icon", "txt" -> "text/plain",
    "bpmn" -> "application/xml", "dmn" -> "application/xml", "woff2" -> "font/woff2", "ttf" -> "font/ttf"
  )

  /** The preview port unless the company sets its own (`DocCreator.docsPreviewPort`). */
  val defaultPort = 3004

  /** The apps' company folders (app -> folder) as `<app>/folder.json` for `extras` - only the
    * folders that exist (`prepareDocs` creates them first); for any other the app shows no hint.
    */
  def folderHints(folders: Seq[(String, os.Path)]): Map[String, String] =
    folders.collect:
      case (app, dir) if os.isDir(dir) => s"$app/folder.json" -> Json.obj("path" -> Json.fromString(dir.toString)).noSpaces
    .toMap

  case class Running(url: String, private val server: HttpServer):
    def stop(): Unit = server.stop(0)

  /** Starts the server (port 0 = any free port) and returns it - or None if the port is taken.
    * `extras` are JSON files served from memory (path relative to the site root -> content),
    * e.g. the company folders for orch-spec and orch-ops; they win over files in the site.
    */
  def start(site: os.Path, port: Int = defaultPort, extras: Map[String, String] = Map.empty): Option[Running] =
    Try(HttpServer.create(InetSocketAddress("localhost", port), 0)).toOption.map: server =>
      server.createContext("/", (ex: HttpExchange) =>
        val raw  = ex.getRequestURI.getPath
        val rel  = java.net.URLDecoder.decode(if raw.endsWith("/") then raw + "index.html" else raw, "UTF-8")
          .dropWhile(_ == '/')
        def send(bytes: Array[Byte], contentType: String): Unit =
          ex.getResponseHeaders.add("Content-Type", contentType)
          ex.sendResponseHeaders(200, bytes.length)
          ex.getResponseBody.write(bytes)
        try
          extras.get(rel) match
            case Some(json) => send(json.getBytes("UTF-8"), contentTypes("json"))
            case None       =>
              val file = scala.util.Try(site / os.RelPath(rel)).toOption.filter(f => f.startsWith(site) && os.isFile(f))
              file match
                case Some(f) => send(os.read.bytes(f), contentTypes.getOrElse(f.ext.toLowerCase, "application/octet-stream"))
                case None    => ex.sendResponseHeaders(404, -1)
        catch
          case _: IOException => // the client went away (e.g. reload) - nothing to report
          case NonFatal(e)    =>
            // headers not sent yet -> a 500; otherwise the client just gets a cut-off response
            Try(ex.sendResponseHeaders(500, -1))
            println(s"Preview: $rel failed - ${e.getMessage}")
        finally ex.close() // also ends the response body
      )
      server.setExecutor(null)
      server.start()
      Running(s"http://localhost:${server.getAddress.getPort}/", server)

  /** Starts the server and keeps the JVM alive - `prepareDocs` ends here, with the URL printed. */
  def serve(site: os.Path, port: Int = defaultPort, extras: Map[String, String] = Map.empty): Unit =
    start(site, port, extras) match
      case Some(running) =>
        println(s"\nPreview ready: ${running.url}  (Ctrl-C to stop)\n")
        Thread.currentThread().join()
      case None      =>
        println(s"\nPort $port is in use - stop what runs there (lsof -nP -iTCP:$port) or give the company another port (`docsPreviewPort` in its CompanyOrchescalaDevHelper). Preview NOT started.\n")

end LocalSiteServer
