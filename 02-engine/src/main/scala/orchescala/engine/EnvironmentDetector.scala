package orchescala.engine

import java.io.File
import java.net.InetAddress
import scala.io.Source
import scala.util.Try

object EnvironmentDetector:

  /** Check if running in Docker container */
  lazy val isRunningInDocker: Boolean =
    checkDockerEnvFile || checkCgroupForDocker || checkContainerEnv

  /** Check if running on localhost (not in Docker) */
  lazy val isLocalhost: Boolean =
    !isRunningInDocker && (isLocalhostHostname || isLocalhostIP)

  /** Check if the .dockerenv file exists (Docker-specific) */
  private def checkDockerEnvFile: Boolean =
    new File("/.dockerenv").exists()

  /** Check /proc/1/cgroup for docker references (Linux containers) */
  private def checkCgroupForDocker: Boolean =
    Try {
      val cgroupFile = new File("/proc/1/cgroup")
      if cgroupFile.exists() then
        val source = Source.fromFile(cgroupFile)
        try
          source.getLines().exists(line =>
            line.contains("docker") || line.contains("/kubepods/")
          )
        finally source.close()
      else false
    }.getOrElse(false)

  /** Check for container-specific environment variables */
  private def checkContainerEnv: Boolean =
    sys.env.contains("KUBERNETES_SERVICE_HOST") ||
    sys.env.get("container").contains("docker") ||
    sys.env.contains("DOCKER_CONTAINER")

  /** Check if hostname suggests localhost */
  private def isLocalhostHostname: Boolean =
    Try {
      val hostname = InetAddress.getLocalHost.getHostName.toLowerCase
      hostname == "localhost" ||
      hostname.startsWith("localhost.") ||
      hostname.endsWith(".local") ||
      !hostname.matches("[a-f0-9]{12}") // Docker uses 12-char hex hostnames
    }.getOrElse(false)

  /** Check if resolved to localhost IP */
  private def isLocalhostIP: Boolean =
    Try {
      val address = InetAddress.getLocalHost.getHostAddress
      address == "127.0.0.1" || address == "::1"
    }.getOrElse(false)

  /** Get a description of the current environment */
  def environmentInfo: String =
    s"""Environment Detection:
       |  - Running in Docker: $isRunningInDocker
       |  - Running on Localhost: $isLocalhost
       |  - Hostname: ${Try(InetAddress.getLocalHost.getHostName).getOrElse("unknown")}
       |  - Host IP: ${Try(InetAddress.getLocalHost.getHostAddress).getOrElse("unknown")}
       |  - Docker Env File: ${checkDockerEnvFile}
       |  - CGroup Check: ${checkCgroupForDocker}
       |  - Container Env Vars: ${checkContainerEnv}
       |""".stripMargin

end EnvironmentDetector

