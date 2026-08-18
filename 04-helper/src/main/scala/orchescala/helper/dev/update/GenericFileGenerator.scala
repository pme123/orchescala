package orchescala.helper.dev.update

import orchescala.helper.util.{PipelineConfig, RepoConfig, RepoCredentials}

case class GenericFileGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    createScalaFmt
    createGitIgnore
    createOrUpdate(config.projectDir / "helper.scala", ScriptCreator().projectHelper)
    os.proc("chmod", "+x", config.projectDir / "helper.scala").call()
    createIfNotExists(config.projectDir / "CHANGELOG.md", changeLog)
    os.makeDir.all(config.projectDir / ".run")
    os.makeDir.all(config.projectDir / ".vscode")
    createOrUpdate(config.projectDir / ".run" / "WorkerTestApp.run.xml", workerTestAppIntellij)
    createOrUpdate(config.projectDir / ".vscode" / "launch.json", workerTestAppVsCode)
    config.pipelineConfig.foreach: pConfig => // only if configured
      createOrUpdate(config.projectDir / ".gitlab-ci.yml", gitLabPipeline(pConfig))
  end generate

  lazy val generateForGateway: Unit =
    createScalaFmt
    createGitIgnore
    createOrUpdate(config.projectDir / "helper.scala", ScriptCreator().projectHelperForGateway)
    os.proc("chmod", "+x", config.projectDir / "helper.scala").call()
    createIfNotExists(config.projectDir / "CHANGELOG.md", changeLog)
  end generateForGateway

  lazy val createScalaFmt  =
    createOrUpdate(config.projectDir / ".scalafmt.conf", scalafmt)
  lazy val createGitIgnore =
    createOrUpdate(config.projectDir / ".gitignore", gitignore)

  private lazy val scalafmt =
    s"""# $helperDoNotAdjustText
       |
       |version = "3.9.4"
       |project.git = true
       |runner.dialect = scala3
       |align.preset = none
       |align.stripMargin = true
       |assumeStandardLibraryStripMargin = true
       |binPack.literalsExclude = ["Term.Name"]
       |
       |maxColumn = 100 // For my wide 30" display.
       |# Recommended, to not penalize `match` statements
       |indent.matchSite = 0
       |
       |# align arrows in for comprehensions
       |align.preset = most
       |
       |newlines.source = keep
       |rewrite.scala3.convertToNewSyntax = true
       |rewrite.scala3.removeOptionalBraces = yes
       |rewrite.scala3.insertEndMarkerMinLines = 5
       |
       |fileOverride {
       |  "glob:**/project/**" {
       |    runner.dialect = scala213
       |  }
       |  "glob:**/build.sbt" {
       |    runner.dialect = scala213
       |  }
       |}
       |""".stripMargin

  private lazy val gitignore =
    s"""# $helperDoNotAdjustText
       |*.class
       |*.log
       |
       |target
       |/project/project
       |/project/target
       |/project/.*
       |.cache
       |.classpath
       |.project
       |.settings
       |bin
       |/.idea/
       |/.sbt/
       |/.ivy2/
       |/.g8/
       |/project/metals.sbt
       |/.bloop/
       |/.ammonite/
       |/.run/
       |/.vscode/
       |/.metals/
       |/.scala-build/
       |/.templUpdate/
       |/.camunda/element-templates/**/dependencies/
       |/.camunda/element-templates/c8/**
       |
       |/.bsp/
       |/**/.generated/
       |/**/.gradle/
       |/**/build/
       |/**/gradle*
       |test.*
       |""".stripMargin

  lazy val changeLog =
    s"""# Changelog
       |
       |All notable changes to this project will be documented in this file.
       |
       |* Types of Changes (L3):
       |  * Added: new features
       |  * Changed: changes in existing functionality
       |  * Deprecated: soon-to-be-removed features
       |  * Removed: now removed features
       |  * Fixed: any bug fixes
       |  * Security: in case of vulnerabilities
       |
       |
       |The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
       |and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
       |
       |""".stripMargin

  private lazy val ssoBaseUrl =
    sys.env.getOrElse("SSO_BASE_URL", s"http://host.lima.internal:8090")

  private lazy val workerTestAppIntellij =
    s"""|<!-- DO NOT ADJUST. This file is replaced by `./helper.scala update` -->
        |<component name="ProjectRunConfigurationManager">
        |  <configuration default="false" name="WorkerTestApp" type="Application" factoryName="Application" nameIsGenerated="true">
        |    <envs>
        |      <env name="SSO_BASE_URL" value="$ssoBaseUrl/auth" />
        |      <env name="WORKER_TEST_MODE" value="true" />
        |    </envs>
        |    <option name="MAIN_CLASS_NAME" value="${config.projectPackage}.worker.WorkerTestApp" />
        |    <module name="${config.projectName}.${config.projectName}-worker" />
        |    <extension name="coverage">
        |      <pattern>
        |        <option name="PATTERN" value="${config.projectPackage}.worker.*" />
        |        <option name="ENABLED" value="true" />
        |      </pattern>
        |    </extension>
        |    <method v="2">
        |      <option name="Make" enabled="true" />
        |    </method>
        |  </configuration>
        |</component>
        |""".stripMargin

  def gitLabPipeline(pipelineConfig: PipelineConfig) =
    val mvnUserEnv     = pipelineConfig.companyMVNUserEnv
      .getOrElse(s"${config.companyName.toUpperCase}_MVN_REPOSITORY_USERNAME")
    val mvnPasswordEnv = pipelineConfig.companyMVNPasswordEnv
      .getOrElse(s"${config.companyName.toUpperCase}_MVN_REPOSITORY_PASSWORD")

    // route coursier (cs) through the company repos - Maven Central only as fallback -
    // to avoid its HTTP 429 rate limiting on shared CI egress IPs
    val artifactoryRepos    = config.sbtConfig.reposConfig.repos.collect:
      case a: RepoConfig.Artifactory => s"${a.artifactoryApiUrl}/${a.repo}"
    val coursierRepos       = ("ivy2Local" +: artifactoryRepos :+ "central").mkString("|")
    val coursierCredentials = config.sbtConfig.reposConfig.credentials
      .collectFirst:
        case c: RepoCredentials.UserPassword =>
          s"\n  COURSIER_CREDENTIALS: ${c.repoHost} $$$mvnUserEnv:$$$mvnPasswordEnv"
      .getOrElse("")
    // the JVM ignores the HTTP(S)_PROXY environment variables - sbt needs explicit flags
    val proxyFlags          = proxyHostAndPort(pipelineConfig.baseProxy)
      .map: (host, port) =>
        s" -Dhttp.proxyHost=$host -Dhttp.proxyPort=$port -Dhttps.proxyHost=$host -Dhttps.proxyPort=$port"
      .getOrElse("")

    s"""
       |# $helperDoNotAdjustText
       |stages:
       |  - test
       |
       |include:
       |  - template: Jobs/SAST.gitlab-ci.yml
       |  - template: Jobs/SAST-IaC.gitlab-ci.yml
       |  - template: Jobs/Dependency-Scanning.gitlab-ci.yml
       |  - template: Jobs/Secret-Detection.gitlab-ci.yml
       |
       |variables:
       |  ALL_PROXY: ${pipelineConfig.baseProxy}
       |  TP_PROXY: $$ALL_PROXY
       |  HTTP_PROXY: $$ALL_PROXY
       |  HTTPS_PROXY: $$ALL_PROXY
       |  SCALA_IMAGE: ${pipelineConfig.baseImage}
       |  $mvnUserEnv: $$CI_REGISTRY_USER
       |  $mvnPasswordEnv: $$CI_REGISTRY_PASSWORD
       |  COURSIER_CACHE: $$CI_PROJECT_DIR/.coursier-cache
       |  COURSIER_REPOSITORIES: $coursierRepos$coursierCredentials
       |
       |worker-test:
       |  stage: test
       |  image:
       |    name: $$SCALA_IMAGE
       |  retry: 2
       |  cache:
       |    key: "$$CI_PROJECT_NAME-sbt"
       |    paths:
       |      - .coursier-cache/
       |      - .sbt-boot/
       |      - .cs-bin/
       |  variables:
       |    CI_DEBUG_SERVICES: false
       |    SBT_OPTS: "-Dsbt.boot.directory=$$CI_PROJECT_DIR/.sbt-boot$proxyFlags"
       |  script:
       |    # the tests call `cs complete-dep` (VersionHelper.repoSearch) - install the native coursier binary
       |    - |
       |      if [ ! -x .cs-bin/cs ]; then
       |        mkdir -p .cs-bin
       |        curl -fL --retry 3 "https://github.com/coursier/launchers/raw/master/cs-x86_64-pc-linux.gz" | gzip -d > .cs-bin/cs
       |        chmod +x .cs-bin/cs
       |      fi
       |    - export PATH="$$PWD/.cs-bin:$$PATH"
       |    # sbt launcher: resolve sbt itself from Maven Central only
       |    # (the Artifactory answers unauthenticated requests with an SSO HTML page the launcher cannot parse)
       |    - mkdir -p ~/.sbt
       |    - |
       |      cat > ~/.sbt/repositories <<EOF
       |      [repositories]
       |        local
       |        maven-central
       |      EOF
       |    # limit concurrent sub-project compilation: the pod's CPU count is often uncapped even
       |    # though its memory is - sbt then schedules too many parallel Scala compilers and gets OOMKilled
       |    - sbt "set Global / concurrentRestrictions := Seq(sbt.Tags.limitAll(2))" "domain/test; worker/test"
       |
       |""".stripMargin
  end gitLabPipeline

  private def proxyHostAndPort(baseProxy: String): Option[(String, String)] =
    Option(baseProxy)
      .map(_.trim)
      .filter(_.nonEmpty)
      .map: proxy =>
        proxy.replaceFirst("^https?://", "").stripSuffix("/").split(":") match
          case Array(host, port) => host -> port
          case other             => other.head -> "8080"

  private lazy val workerTestAppVsCode   =
    s"""|// DO NOT ADJUST. This file is replaced by `./helper.scala update`.
        |{
        |    "version": "2.0.0",
        |    "configurations": [
        |
        |        {
        |            "type": "scala",
        |            "request": "launch",
        |            "name": "WorkerTestApp",
        |            "mainClass": "${config.projectPackage}.worker.WorkerTestApp",
        |            "args": [],
        |            "jvmOptions": [],
        |            "env": { "SSO_BASE_URL": "$ssoBaseUrl/auth", "WORKER_TEST_MODE": "true"},
        |        }
        |    ]
        |}
        |""".stripMargin
end GenericFileGenerator
