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
            s"${Console.RED}NOT Updated - 03-api/OpenApi.html + PostmanOpenApi.html: the company helper " +
              s"ships no ${apiHtmlResource.segments.last} (run the company's `./helper.scala update` " +
              s"with PublishConfig.apiDocPath set and publish the company helper).${Console.RESET}"
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

  private lazy val apiHtmlResource: os.ResourcePath =
    config.publishConfig.map(_.apiHtmlResource).getOrElse(os.resource / "OrchDocApi.html")

  /** The company helper's orch-doc page (PublishConfig.apiHtmlResource, put there by the company's
    * `update`) - with the do-not-adjust marker in front, so the next `update` replaces it again.
    */
  private lazy val orchDocApiHtml: Option[String] =
    scala.util.Try(os.read(apiHtmlResource)).toOption
      .map(html => s"<!-- $helperDoNotAdjustText -->\n$html")

end ApiGenerator
