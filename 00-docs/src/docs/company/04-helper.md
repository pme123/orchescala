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

## CompanyOrchescalaDevHelper
The `CompanyOrchescalaDevHelper` is a helper dedicated for the `company-orchescala` project.

See [Development]

```scala
object CompanyOrchescalaDevHelper
  extends DevCompanyOrchescalaHelper:

lazy val apiConfig: ApiConfig = CompanyApiCreator.apiConfig
  .copy(
    basePath = os.pwd / "00-docs",
    tempGitDir = os.pwd / os.up / "git-temp"
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