package orchescala.helper.dev.update

import orchescala.api.ModuleType

case class ApiGenerator()(using config: DevConfig):

  lazy val generate: Unit =
    if config.apiProjectConfig.modules.contains(ModuleType.api) then
      createIfNotExists(
        config.projectDir / ModuleConfig.apiModule.packagePath(
          config.projectPath
        ) / "ApiProjectCreator.scala",
        api
      )
      orchDocApiHtml match
        case Some(html) =>
          // orch-doc's single-file page: the same html for both - it loads the yml named like
          // its own file (OpenApi.yml / PostmanOpenApi.yml)
          createOrUpdate(config.projectDir / "03-api" / "OpenApi.html", html)
          createOrUpdate(config.projectDir / "03-api" / "PostmanOpenApi.html", html)
        case None       =>
          println(
            s"${Console.RED}NOT Updated - 03-api/OpenApi.html + PostmanOpenApi.html: no " +
              s"${apiHtmlResource.segments.last} on the classpath - the orchescala-orch-doc jar " +
              s"(a dependency of orchescala-helper) is missing or was built without Node.js.${Console.RESET}"
          )
  end generate

  lazy val api =
    s"""package ${config.projectPackage}
       |package api
       |
       |object ApiProjectCreator extends CompanyApiCreator:
       |
       |  val title = "${config.projectName}"
       |
       |  lazy val projectDescr =
       |    "TODO Your Project description."
       |
       |  val version = "0.1.0-SNAPSHOT"
       |
       |  document(
       |    //myProcessApi,
       |    //..
       |  )
       |
       |  /* example:
       |  private lazy val myProcessApi =
       |    import myProcess.v1.*
       |    api(MyProcess.example)(
       |      // userTasks / workers etc.
       |    )
       |  */
       |end ApiProjectCreator
       |""".stripMargin
  end api

  // orch-doc's single-file API page - built into the orchescala-orch-doc jar (see build.sbt,
  // `bundleDocClient`), a dependency of the helper
  private lazy val apiHtmlResource: os.ResourcePath = os.resource / "OrchDocApi.html"

  /** The API page with the do-not-adjust marker in front, so the next `update` replaces it. */
  private lazy val orchDocApiHtml: Option[String] =
    scala.util.Try(os.read(apiHtmlResource)).toOption
      .map(html => s"<!-- $helperDoNotAdjustText -->\n$html")

end ApiGenerator
