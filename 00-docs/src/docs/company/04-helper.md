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
  dockerBuildOptions = Seq("--platform", "linux/amd64")
)
```
@:callout(warning)
The default builds **every** image for `linux/amd64` - on an amd64 machine nothing changes, on
Apple Silicon the images are amd64 from the next `./helper.scala update` on (as OpenShift needs them).
For arm64 images set `dockerBuildOptions = Seq.empty` (the machine's platform) or your own platform.
@:@

`dockerBuildSettings` appends to `dockerBuildOptions` (`++=`) and comes after your `dockerSettings` in
the build - so a `dockerBuildOptions := Seq(...)` of yours keeps the platform. An own `dockerBuildCommand`
replaces the whole command, the platform included - then add `--platform` there yourself.

@:callout(info)
`--platform` needs BuildKit, i.e. the `buildx` plugin of the Docker CLI - the legacy builder of
Docker 29 (e.g. Colima) fails with _does not provide the specified platform (linux/amd64)_.
With Homebrew the plugin is installed but not linked:

```
brew install docker-buildx
mkdir -p ~/.docker/cli-plugins
ln -sfn $(brew --prefix)/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx
docker buildx version
```
The `RUN` steps of the image are emulated (Rosetta or QEMU, Colima registers both) - no x86_64 VM is needed.
@:@

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