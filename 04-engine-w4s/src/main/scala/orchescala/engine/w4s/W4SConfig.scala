package orchescala.engine.w4s

import orchescala.engine.EngineConfig

/** Configuration for the W4S UI server.
  *
  * @param port
  *   The port the embedded http4s server listens on (default: 4444).
  * @param apiUrl
  *   The base URL the browser-side UI uses to call the backend API. Leave empty to derive it
  *   automatically from `port` (recommended). Override only when the server is behind a reverse
  *   proxy or is accessed from a different host.
  */
case class W4SConfig(
    port: Int = 4444,
    apiUrl: String = ""
):
  /** Effective API URL used by the UI frontend.
    * When `apiUrl` is empty (default), it is derived as `http://localhost:<port>`.
    */
  def effectiveApiUrl: String =
    if apiUrl.nonEmpty then apiUrl
    else s"http://localhost:$port"
