package orchescala.helper.dev.update

import orchescala.api.DependencyConfig

case class GatewayGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    createOrUpdate(gatewayPath / "GatewayServerApp.scala", gatewayApp)
    createOrUpdate(gatewayConfigPath / "logback.xml", logbackXml)
  end generate

  private lazy val companyName = config.companyName
  private lazy val gatewayApp  =
    val objName      = "GatewayServerApp"
    val dependencies = config.apiProjectConfig.dependencies

    s"""$helperDoNotAdjustText
       |package ${config.projectPackage}.gateway
       |
       |// sbt gateway/run
       |object $objName extends CompanyGatewayServerApp:
       |  // You can add single workers, lists of workers or even complete WorkerApps. And a mix of all of them.
       |  supportedWorkers(
       |    ${dependencies
        .map:
          _.projectPackage + ".worker.WorkerApp"
        .mkString("", ",\n    ", "")}
       |  )
       |end $objName""".stripMargin
  end gatewayApp

  lazy val logbackXml =
    s"""<!-- DO NOT ADJUST. This file is replaced by `./helper.scala update` -->
       |<configuration>
       |    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
       |        <encoder>
       |            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
       |        </encoder>
       |    </appender>
       |
       |    <logger name="orchescala" level="INFO"/>
       |    <logger name="${config.companyName}" level="INFO"/>
       |    <logger name="org.glassfish.jaxb" level="WARN"/>
       |    <logger name="com.sun.xml.bind" level="WARN"/>
       |
       |    <root level="WARN">
       |        <appender-ref ref="STDOUT" />
       |    </root>
       |</configuration>
       |""".stripMargin

  private lazy val gatewayPath =
    config.projectDir /
      ModuleConfig.gatewayModule.packagePath(config.projectPath)

  private lazy val gatewayConfigPath =
    val dir = config.projectDir / ModuleConfig.gatewayModule.packagePath(
      config.projectPath,
      isSourceDir = false
    )
    os.makeDir.all(dir)
    dir
  end gatewayConfigPath
end GatewayGenerator
