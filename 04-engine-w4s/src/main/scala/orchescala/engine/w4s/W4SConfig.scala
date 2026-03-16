package orchescala.engine.w4s

import com.comcast.ip4s.{Host, Port, ipv4}
import orchescala.engine.EngineConfig

/** Configuration for the W4S UI server.
  *
  * @param port
  *   The port the embedded http4s server listens on (default: 4444).
  * @param host
  *   The base URL the browser-side UI uses to call the backend API. Leave empty to derive it
  *   automatically from `port` (recommended). Override only when the server is behind a reverse
  *   proxy or is accessed from a different host.
  */
trait W4SConfig:
  def port: Port
  def host: Host
  def effectiveApiUrl: String
  
case class DefaultW4SConfig(
    port: Port = Port.fromInt(4444).get,
    host: Host = ipv4"0.0.0.0"
) extends W4SConfig:
  def effectiveApiUrl: String = s"http://$host:$port"
