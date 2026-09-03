package orchescala.helper.dev.company.docs.site

import com.sun.net.httpserver.{HttpExchange, HttpServer}

import java.net.InetSocketAddress

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

  /** Starts the server and returns its URL - or None if the port is taken. */
  def start(site: os.Path, port: Int = 3004): Option[String] =
    scala.util.Try(HttpServer.create(InetSocketAddress("localhost", port), 0)).toOption.map: server =>
      server.createContext("/", (ex: HttpExchange) =>
        val raw  = ex.getRequestURI.getPath
        val rel  = java.net.URLDecoder.decode(if raw.endsWith("/") then raw + "index.html" else raw, "UTF-8")
        val file = scala.util.Try(site / os.RelPath(rel.dropWhile(_ == '/'))).toOption.filter(f => f.startsWith(site) && os.isFile(f))
        file match
          case Some(f) =>
            val bytes = os.read.bytes(f)
            ex.getResponseHeaders.add("Content-Type", contentTypes.getOrElse(f.ext.toLowerCase, "application/octet-stream"))
            ex.sendResponseHeaders(200, bytes.length)
            ex.getResponseBody.write(bytes)
          case None    =>
            ex.sendResponseHeaders(404, -1)
        ex.close()
      )
      server.setExecutor(null)
      server.start()
      s"http://localhost:$port/"

  /** Starts the server and keeps the JVM alive - `prepareDocs` ends here, with the URL printed. */
  def serve(site: os.Path, port: Int = 3004): Unit =
    start(site, port) match
      case Some(url) =>
        println(s"\nPreview ready: $url  (Ctrl-C to stop)\n")
        Thread.currentThread().join()
      case None      =>
        println(s"\nPort $port is in use - stop what runs there (lsof -nP -iTCP:$port) or use another port. Preview NOT started.\n")

end LocalSiteServer
