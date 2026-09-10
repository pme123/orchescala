package orchescala.helper.util

import orchescala.engine.config.{ReposConfig}

case class SbtConfig(
    // sbt settings for publishing
    reposConfig: ReposConfig = ReposConfig.dummyRepos,
    // sbt settings for docker
    dockerSettings: Option[String] = None,
    dockerGatewaySettings: Option[String] = None
)
