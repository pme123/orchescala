# 04-helper

## CompanyDevHelper
With the `CompanyDevHelper` you can customize  the development process for each project.

```scala 
case object CompanyDevHelper
  extends DevHelper:

lazy val apiConfig: ApiConfig = CompanyApiCreator.apiConfig
lazy val devConfig: DevConfig = CompanyDevConfig.config

end CompanyDevHelper
```
### ApiConfig
Taken from `CompanyApiCreator.apiConfig`, see [CompanyApiCreator]

### DevConfig
Taken from `CompanyApiCreator.apiConfig`, see [CompanyDevConfig]

## CompanyDevConfig
The `CompanyDevConfig` is a helper to create the `DevConfig` for the `CompanyDevHelper`.

```scala
object CompanyDevConfig:

    lazy val companyConfig =
      config(
        ApiProjectConfig(
          projectName = BuildInfo.name,
          projectVersion = BuildInfo.version
        )
      )
    
    lazy val config: DevConfig =
      config(ApiProjectConfig())
    
    def config(apiProjectConfig: ApiProjectConfig) =
      DevConfig(
        apiProjectConfig,
        //sbtConfig = companySbtConfig,
        //versionConfig = companyVersionConfig,
        //publishConfig = Some(companyPublishConfig),
        //postmanConfig = Some(companyPostmanConfig),
        //dockerConfig = companyDockerConfig
      )

    private lazy val companyVersionConfig = CompanyVersionConfig(
      scalaVersion = BuildInfo.scalaVersion,
      orchescalaVersion = BuildInfo.orchescalaV,
      companyOrchescalaVersion = BuildInfo.version,
      sbtVersion = BuildInfo.sbtVersion,
      otherVersions = Map()
    )
end CompanyDevConfig
```
Here the default values for `DevConfig`:
```scala
case class DevConfig(
  // project configuration taken from the PROJECT.conf
  apiProjectConfig: ApiProjectConfig,
  // additional sbt configuration for sbt generation
  sbtConfig: SbtConfig = SbtConfig(),
  // versions used for generators
  versionConfig: CompanyVersionConfig = CompanyVersionConfig(),
  // If you have a Postman account, add the config here (used for ./helper.scala deploy..)
  postmanConfig: Option[PostmanConfig] = None,
  // Adjust the DockerConfig (used for ./helper.scala deploy../ docker..)
  dockerConfig: DockerConfig = DockerConfig(),
  // If you have a webdav server to publish the docs, add the config here (used in ./helper.scala publish..)
  publishConfig: Option[PublishConfig] = None,
  // general project structure -  do not change if possible -
  modules: Seq[ModuleConfig] = DevConfig.modules
)
```

### SbtConfig
The `sbtConfig` is generated into `project/Settings.scala` of each project by `./helper.scala update` -
so configure it here, in `CompanyDevConfig.scala`, where the update does not touch it.

```scala
private lazy val companySbtConfig = SbtConfig(
  // the repositories and credentials for publishing
  reposConfig = companyReposConfig,
  // sbt settings for the Docker image of the worker (sbt-native-packager)
  dockerSettings = Some("""Seq(
    dockerBaseImage := "eclipse-temurin:21-jre",
    dockerRepository := Some("artifactory.company.ch/docker-local")
  )"""),
  // the options of `docker build` - generated as `dockerBuildSettings`.
  // OpenShift runs amd64 images only, while Apple Silicon (e.g. Colima) builds arm64 by default -
  // so the platform is fixed (the default). `Seq.empty` builds for the platform of the machine.
  dockerBuildOptions = Seq("--platform", "linux/amd64"),
  // the options of the sbt runs of `./helper.scala publish` - a runner with less memory sets its own
  publishSbtOptions = Seq("-J-Xmx3G")
)
```
#### Repos and Docker from the env variables
Instead of fixed values the generated `project/Settings.scala` can read the env variables of the
company - the same ones the build of the `company-orchescala` project uses. So a project follows
them without a new `./helper.scala update`; the values at the time of the update are only the fallback.

```scala
private lazy val companySbtConfig = SbtConfig(
  // {COMPANY}_MVN_RELEASE_REPOSITORY, {COMPANY}_MVN_DEPENDENCY_REPOSITORY (optional),
  // {COMPANY}_MVN_REPOSITORY_USERNAME / _PASSWORD
  reposConfig = ReposConfig.artifactoryFromEnv("mycompany"),
  // {COMPANY}_DOCKER_REPOSITORY, {COMPANY}_DOCKER_BASE_IMAGE
  dockerSettings = Some(SbtConfig.dockerSettingsFromEnv(
    "mycompany",
    // optional - without it: SbtConfig.defaultBaseImage (eclipse-temurin:21-jre)
    defaultBaseImage = "registry.mycompany.com/openjdk-21-runtime:1.0.0",
    // optional - only for a base image with its own entrypoint script
    otherSettings = Seq("""dockerEntrypoint := Seq("/opt/sbin/entrypoint.sh")""")
  ))
)
```
> [!WARNING]
> **Changed:** without `dockerSettings` the images are built on `SbtConfig.defaultBaseImage`
> (`eclipse-temurin:21-jre`) from the next `./helper.scala update` on - before, it was the default of
> sbt-native-packager (`openjdk:8`), which is no longer on Docker Hub.

Without `{COMPANY}_MVN_RELEASE_REPOSITORY` (or with an empty one) it is the dummy repo. A url that is
set but no `http(s)://<host>/.../<repo>` - with a query, a fragment or user info (`user:password@`)
- fails with an error naming the variable (the password masked) - on purpose: the company config
reads it, so every command of the helper stops (with the message, no stack trace), instead of
publishing to or resolving from the dummy repo. User info is refused as the url is written into
the generated `project/Settings.scala`, which is committed.

The generated build reads a variable the same way as the helper: spaces around and slashes at the
end removed, an empty one counts as not set. Without the variable it takes the url of the last
`./helper.scala update` - maybe of another machine - and prints a warning; a url without host gives
a warning too, and the credentials keep the host of the update.

The dependency repo gets its own resolver name `Artifactory Realm 2` (the name of the sbt
resolver, not the auth realm) - sbt does not load from two resolvers of the same host with the same
name (_unauthorized_ / _forbidden_). It also gets its own credentials (the same user and password
variables, the host from its url), so it may move to another host without a new
`./helper.scala update` - on the same host sbt keeps one of the two.

The env names are upper case, other characters than letters and digits become `_`
(`acme-bank` → `ACME_BANK_...`).

> [!NOTE]
> Only the generated build reads the variables - the helper itself (e.g. the release check) uses
> the urls of the config, with `artifactoryFromEnv` read from the same variables.

> [!WARNING]
> The default builds **every** image for `linux/amd64` - on an amd64 machine nothing changes, on
> Apple Silicon the images are amd64 from the next `./helper.scala update` on (as OpenShift needs them).
> For arm64 images set `dockerBuildOptions = Seq.empty` (the machine's platform) or your own platform.

`dockerBuildSettings` appends to `dockerBuildOptions` (`++=`) and comes after your `dockerSettings` in
the build - so a `dockerBuildOptions := Seq(...)` of yours keeps the platform. An own `dockerBuildCommand`
replaces the whole command, the platform included - then add `--platform` there yourself.

> [!NOTE]
> `--platform` needs BuildKit, i.e. the `buildx` plugin of the Docker CLI - the legacy builder of
> Docker 29 (e.g. Colima) fails with _does not provide the specified platform (linux/amd64)_.
> With Homebrew the plugin is installed but not linked:
>
> ```
> brew install docker-buildx
> mkdir -p ~/.docker/cli-plugins
> ln -sfn $(brew --prefix)/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx
> docker buildx version
> ```
> The `RUN` steps of the image are emulated (Rosetta or QEMU, Colima registers both) - no x86_64 VM is needed.

## CompanyOrchescalaDevHelper
The `CompanyOrchescalaDevHelper` is a helper dedicated for the `company-orchescala` project.

See [Development]

```scala
object CompanyOrchescalaDevHelper
  extends DevCompanyOrchescalaHelper:

lazy val apiConfig: ApiConfig = CompanyApiCreator.apiConfig
  .copy(
    basePath = os.pwd / "00-docs",
    tempGitDir = os.pwd / os.up / os.up / "git-temp"
  )

lazy val devConfig: DevConfig = CompanyDevConfig.companyConfig

end CompanyOrchescalaDevHelper
```

### apiConfig
The `apiConfig` is taken from `CompanyApiCreator.apiConfig` and can be customized.
The `basePath` and the `tempGitDir` must be adjusted, as `company-orchescala` 
has a different file structure, compared to a project.

### devConfig
Here your `DevConfig` defined in the `CompanyDevConfig.config` method, should work. 
The only adjustments are the `projectName` and that no `subProjects` are needed.