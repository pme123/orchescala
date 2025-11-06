package orchescala.api

import orchescala.BuildInfo
import orchescala.domain.*
import io.circe.Encoder
import sttp.apispec.openapi.*
import sttp.apispec.openapi.circe.yaml.*
import sttp.tapir.*
import sttp.tapir.docs.apispec.DocsExtension
import sttp.tapir.docs.openapi.{OpenAPIDocsInterpreter, OpenAPIDocsOptions}

import java.text.SimpleDateFormat
import java.util.Date
import scala.util.matching.Regex
import scala.jdk.CollectionConverters.*

trait ApiCreator extends PostmanApiCreator, TapirApiCreator, App:

  protected def companyProjectVersion: String
  protected def projectDescr: String
  protected def apiProjectConfig: ApiProjectConfig = ApiProjectConfig(apiConfig.projectConfPath)

  def supportedVariables: Seq[InputParams] =
    InputParams.values.toSeq

  def document(apis: CApi*): Unit =
    val apiDoc = ApiDoc(apis.toList)
    apiConfig.init // pulls all dependencies.
    ModelerTemplGenerator(version,
      apiConfig.modelerTemplateConfigs, 
      projectName, apiProjectConfig.companyName).generate(
      collectApis(apiDoc)
    )
    ModelerTemplUpdater(apiConfig, apiProjectConfig).update()
    writeOpenApis(apiDoc)
    writeCatalog(apiDoc)
  end document

  private def writeOpenApis(apiDoc: ApiDoc): Unit =
    writeOpenApi(
      apiConfig.openApiPath,
      openApi(apiDoc),
      apiConfig.openApiDocuPath
    )
    writeOpenApi(
      apiConfig.postmanOpenApiPath,
      postmanOpenApi(apiDoc),
      apiConfig.postmanOpenApiDocuPath
    )
    println(s"Check Open API Docu: ${apiConfig.openApiDocuPath}")
  end writeOpenApis

  protected lazy val openAPIDocsInterpreter      =
    OpenAPIDocsInterpreter(docsOptions =
      OpenAPIDocsOptions.default.copy(defaultDecodeFailureOutput = _ => None)
    )
  import sttp.tapir.json.circe.*
  protected def openApi(apiDoc: ApiDoc): OpenAPI =
    val endpoints = create(apiDoc)
    openAPIDocsInterpreter
      .toOpenAPI(
        endpoints,
        info(title, Some(description)),
        docsExtensions = List(DocsExtension.of(
          "tags",
          apiDoc.groupTags.asJson
        ))
      )

  end openApi

  protected def postmanOpenApi(apiDoc: ApiDoc): OpenAPI =
    val endpoints = createPostman(apiDoc)
    openAPIDocsInterpreter
      .toOpenAPI(endpoints, info(title, Some(postmanDescription)))
      .servers(servers)
  end postmanOpenApi

  protected def createChangeLog(): String =
    val changeLogFile = basePath / "CHANGELOG.md"
    if changeLogFile.toIO.exists() then
      s"""
         |<details>
         |<summary><b><i>CHANGELOG.md</i></b></summary>
         |<p>
         |
         |${os.read
          .lines(changeLogFile)
          .tail
          .map(_.replace("##", "###"))
          .map(replaceJira(_, apiConfig.jiraUrls))
          .mkString("\n")}
         |
         |</p>
         |</details>
         |""".stripMargin
    else
      ""
    end if
  end createChangeLog

  protected def createGeneralVariables(): String =
    s"""|<p/>
        |<details>
        |<summary>
        |<b><i>General Variables</i></b>
        |</summary>
        |
        |<p>
        |
        |### Mocking
        |""".stripMargin +
      createGeneralVariable(
        InputParams.servicesMocked,
        "Mock all the _ServiceWorkers_ in your process with their default Mock:",
        "process(..)\n  .mockServices",
        s"\"${InputParams.servicesMocked}\": true,"
      ) +
      createGeneralVariable(
        InputParams.mockedWorkers,
        s"""Mock any Process- and/or ExternalTask-Worker with their default Mocks.
           |This is a list of the _Worker topicNames or Process processNames_, you want to mock.
           |${listOfStringsOrCommaSeparated("mySubProcess,myOtherSubProcess,myService")}
           |
           |_Be aware_: For Sub-Processes, this expects an _InitWorker_ where the _topicName_ is equal to the _processName_.
           |""".stripMargin,
        """process(..)
          |  .mockedWorkers("mySubProcess1", "mySubProcess2") // creates a list with SubProcessess
          |  .mockedWorker("myOtherSubProcess") // adds a SubProcess""".stripMargin,
        """"mockedWorkers": ["mySubProcess", "myOtherSubProcess, myService"],"""
      ) +
      createGeneralVariable(
        InputParams.outputMock,
        """Mock the Process or ExternalTask (`Out`)
          | - You find an example in every _Process_ and _ExternalTask_.
          |""".stripMargin,
        """process(..) // or serviceTask(..)/customTask(..)
          |  .mockWith(outputMock)""".stripMargin,
        """"outputMock": {..},"""
      ) +
      createGeneralVariable(
        InputParams.outputServiceMock,
        """Mock the Inner-Service (`MockedServiceResponse[ServiceOut]`)
          | - You find an example in every _ServiceTask_.
          |""".stripMargin,
        """serviceTask(..)
          |  .mockServiceWith(MockedServiceResponse
          |     .success200(inOut.defaultServiceOutMock))""".stripMargin,
        s""""outputServiceMock": ${MockedServiceResponse
            .success200("Example String Body")
            .asJson.deepDropNullValues},""".stripMargin
      ) +
      "### Mapping" +
      createGeneralVariable(
        InputParams.outputVariables,
        s"""You can filter the Output with a list of variable names you are interested in.
           |This list may include all variables from the output (`Out`). We included an example for each Process or ExternalTask.
           |${listOfStringsOrCommaSeparated("name,firstName")}
           |""".stripMargin,
        """process(..) // or serviceTask(..)/customTask(..)
          |  .withOutputVariables("name", "firstName") // creates a list with outputVariables
          |  .withOutputVariable("nickname") // adds a outputVariable""".stripMargin,
        """"outputVariables": ["name", "firstName"],"""
      ) +
      createGeneralVariable(
        InputParams.manualOutMapping,
        s"""By default all output Variables (`Out`) are on the Process for _External Tasks_.
           |If the filter _${InputParams.outputVariables}_ is not enough,
           |you can set this variable - every output variable is then local.
           |
           |_Be aware_ that you must then manually have _output mappings_ for each output variable!
           |""".stripMargin,
        """serviceTask(..) // or customTask(..)
          |  .manualOutMapping""".stripMargin,
        """"manualOutMapping": true,"""
      ) + "### Mocking" +
      createGeneralVariable(
        InputParams.handledErrors,
        s"""A list of error codes that are handled (`BpmnError`)
           |${listOfStringsOrCommaSeparated("validation-failed,404")}
           |
           |At the moment only _ServiceTasks_ supported.
           |""".stripMargin,
        """serviceTask(..)
          |  .handleErrors(ErrorCodes.`validation-failed`, "404") // create a list of handledErrors
          |  .handleError("404") // add a handledError""".stripMargin,
        s""""handledErrors": ["validation-failed", "404"],""".stripMargin
      ) +
      createGeneralVariable(
        InputParams.regexHandledErrors,
        s"""You can further filter Handled Errors with a list of Regex expressions that the body error message must match.
           |${listOfStringsOrCommaSeparated(
            "SQL exception,\"errorNr\":\"20000\""
          )}
           |
           |At the moment only _ServiceTasks_ supported.
           |""".stripMargin,
        """serviceTask(..)
          |  .handleErrorWithRegex("SQL exception")
          |  .handleErrorWithRegex("\"errorNr\":\"20000\"")""".stripMargin,
        s""""regexHandledErrors": ["SQL exception", "\"errorNr\":\"20000\""],""".stripMargin
      ) +
      "### Authorization" +
      createGeneralVariable(
        InputParams.impersonateUserId,
        """User-ID of a User that should be taken to authenticate to the services.
          |This must be supported by your implementation. *Be caution: this may be a security issue!*.
          |It is helpful if you have Tokens that expire, but long running Processes.""".stripMargin,
        """process(..) // or serviceTask(..)/customTask(..)
          |  .withImpersonateUserId(impersonateUserId)""".stripMargin,
        """"impersonateUserId": "myUserName","""
      ) +
      """</p>
        |</details>
        |<p/>
        """.stripMargin
  end createGeneralVariables

  def createGeneralVariable(
      key: InputParams,
      descr: String,
      scalaExample: String,
      jsonExample: String
  ) =
    if supportedVariables.contains(key) then
      s"""
         |**$key**:
         |
         |$descr
         |
         |- DSL:
         |```scala
         |$scalaExample
         |```
         |
         |- Json
         |```json
         |...
         |$jsonExample
         |...
         |```
         |
         |""".stripMargin
    else
      ""
  end createGeneralVariable

  protected def replaceJira(
      line: String,
      jiraUrls: Map[String, String]
  ): String =
    jiraUrls.toList match
      case Nil                => line
      case (k -> url) :: tail =>
        val regex   = Regex(s"""$k-(\\d+)""")
        val matches = regex.findAllIn(line).toSeq
        val changed =
          matches.foldLeft(line)((a, b) => a.replace(b, s"[$b]($url/$b)"))
        replaceJira(changed, tail.toMap)

  protected def packageConf =
    if packageConfPath.toIO.exists() then
      s"""# Package Configuration
         |**Check all dependency trees here: [$projectName](../../dependencies/$projectName.html)**
         |
         |$dependencies
         |
         |<details>
         |<summary>${apiConfig.projectsConfig.projectConfPath}</summary>
         |<p>
         |
         |```
         |
         |${os.read(packageConfPath).trim}
         |
         |```
         |
         |</p>
         |</details>
         |""".stripMargin
    else ""

  protected def postmanInstructions =
      s"""<details>
         |<summary><b><i>Postman Instructions</i></b></summary>
         |<p>
         |You can directly import this OpenApi YAML to [Postman](https://www.postman.com/).
         |
         |Only thing you need to adjust is in the Collection.
         |- **Authorization**: `Bearer Token` with the `{{access_token}}` from the `GetToken` request.
         |- **Variables**: `tenantId`: `{{bank}}`
         |- **Scripts - Pre-Request**:
         |
         |```javascript
         |// Refresh the OAuth token if necessary
         |let tokenDate = new Date(2010, 1, 1);
         |const tokenTimestamp = pm.environment.get("OAuth_Timestamp");
         |if (tokenTimestamp) {
         |  tokenDate = Date.parse(tokenTimestamp);
         |}
         |let expiresInTime = pm.environment.get("ExpiresInTime");
         |if (!expiresInTime) {
         |  expiresInTime = 300000; // Set default expiration time to 5 minutes
         |}
         |if (new Date() - tokenDate >= expiresInTime) {
         |pm.sendRequest(
         |{
         |  url: `$${pm.environment.get(
         |      "tokenService"
         |    )}/auth/realms/$${pm.environment.get(
         |      "bank"
         |    )}/protocol/openid-connect/token`,
         |  method: "POST",
         |  header: {
         |    "Content-Type": "application/x-www-form-urlencoded",
         |  },
         |  body: {
         |    mode: "urlencoded",
         |    urlencoded: [
         |      { key: "grant_type", value: "password" },
         |      { key: "client_id", value: pm.environment.get("clientId")},
         |      { key: "client_secret", value: pm.environment.get("clientSecret")},
         |      { key: "username", value: pm.environment.get("username")},
         |      { key: "password", value: pm.environment.get("pwd") },
         |      { key: "scope", value: pm.environment.get("scope") },
         |    ],
         |  },
         |},
         |  (_, res) => {
         |    pm.environment.set("access_token", res.json().access_token);
         |    pm.environment.set("OAuth_Timestamp", new Date());
         |    // Set the ExpiresInTime variable to the time given in the response if it exists
         |    if (res.json().expires_in) {
         |      expiresInTime = res.json().expires_in * 1000;
         |    }
         |    pm.environment.set("ExpiresInTime", expiresInTime);
         |  });
         |}
         |  ```
         |
         |- **Scripts - Post-Response**:
         |
         |```javascript
         |  // Collection-level test script
         |  pm.test("Auto-set variables", function () {
         |    const response = pm.response.json();
         |
         |    // Set processInstanceId if present
         |    if (response.processInstanceId) {
         |        const id = response.processInstanceId;
         |        pm.collectionVariables.set("processInstanceId", id);
         |        console.log("Set processInstanceId: " + id);
         |    }
         |
         |    // Set taskId for array responses
         |    if (pm.response.headers.get("userTaskId")) {
         |        const id = pm.response.headers.get("userTaskId")
         |        pm.collectionVariables.set("userTaskInstanceId", id);
         |        console.log("userTaskInstanceId: " + id)
         |
         |    }
         |
         |});
         |  ```
         |
         |</p>
         |</details>
         |""".stripMargin

  protected def dependencies: String =

    def docPortal(projectName: String) =  s"${apiConfig.docBaseUrl.getOrElse("NOT_SET")}/$projectName/OpenApi.html"

    val projects       = apiConfig.projectsConfig.perGitRepoConfigs.flatMap(_.projects)
    println(s"Projects: $projects")
    def documentations =
      projects.map(pc => pc.name -> docPortal(pc.name)).toMap

    s"""|### Dependencies:
        |
        |${
         docProjectConfig.dependencies
           .map(dep => s"- _**[${dep.projectName}](${documentations.getOrElse(dep.projectName, "NOT FOUND")})**_")
           .mkString("\n")
       }
        |""".stripMargin
  end dependencies

  protected def createReadme(): String =
    val readme = basePath / "README.md"
    if readme.toIO.exists() then
      os.read.lines(readme).tail.mkString("\n")
    else
      "There is no README.md in the Project."
  end createReadme

  protected def description: String =
    s"""
       |
       |$projectDescr
       |
       |Created at ${SimpleDateFormat().format(new Date())}
       |
       |**See the [Orchescala Documentation](https://pme123.github.io/orchescala/)**
       |
       |$postmanInstructions
       |
       |$packageConf
       |
       |${createReadme()}
       |
       |${createChangeLog()}
       |
       |${createGeneralVariables()}
       |
       |> Created with:
       |> - [orchescala-api v${BuildInfo.version}](https://github.com/pme123/orchescala)
       |> - ${docProjectConfig.companyName}-orchescala-api $companyProjectVersion
       |> - ${docProjectConfig.companyName}-orchescala-helper
       |
       |""".stripMargin

  protected def postmanDescription: String =
    s"""
         |**This is for Postman - to have example requests. Be aware the Output is not provided!**
         |
         |$description
         |"""

  private def writeOpenApi(
      path: os.Path,
      api: OpenAPI,
      docPath: os.Path,
      adjustOpenApi: String => String = identity
  ): Unit =
    if os.exists(path) then
      os.remove(path)
    val yaml = adjustOpenApi(api.toYaml)
    os.write(path, yaml)
    println(s"Created Open API $path")
    println(s"See Open API Html $docPath")
  end writeOpenApi

  private def writeCatalog(apiDoc: ApiDoc): Unit =
    val catalogPath = apiConfig.catalogPath
    if os.exists(catalogPath) then
      os.remove(catalogPath)
    val catalog     = toCatalog(apiDoc)
    os.write(catalogPath, catalog)
    println(s"Created Catalog $catalogPath")
  end writeCatalog

  private def toCatalog(apiDoc: ApiDoc): String =
    val optimizedApis = collectApisWithGroup(apiDoc)
    s"""### $title
       |${toCatalog(optimizedApis)}
       |""".stripMargin
  end toCatalog

  // takes exactly one api
  private def collectApisWithGroup(apiDoc: ApiDoc): List[(InOutApi[?, ?], String)] =
    apiDoc.apis.foldLeft(List.empty[(InOutApi[?, ?], String)]) {
      case (result, groupedApi: ProcessApi[?, ?, ?]) =>
        result ++ (groupedApi.apis :+ groupedApi).map(_ -> groupedApi.name)
      case (result, groupedApi: GroupedApi)          =>
        result ++ groupedApi.apis.map(_ -> groupedApi.name)
      case (result, _)                               =>
        result
    }.distinct

  // takes exactly one api
  private def collectApis(apiDoc: ApiDoc): List[InOutApi[?, ?]] =
    collectApisWithGroup(apiDoc)
      .map:
        _._1

  private def toCatalog(
      apis: List[(InOutApi[?, ?], String)]
  ): String =
    apis
      .map:
        case api -> anchor =>
          s"- ${createLink(api.endpointName(InOutDocu.BOTH), Some(anchor))}"
      .sorted
      .mkString("\n")
  end toCatalog

  private def listOfStringsOrCommaSeparated(example: String) =
    s"""It is also possible to use a _comma separated_ String,
       |like `"$example"`""".stripMargin

  private lazy val packageConfPath = apiConfig.basePath / apiConfig.projectsConfig.projectConfPath
  private lazy val docProjectConfig  = DocProjectConfig(apiProjectConfig)

end ApiCreator
