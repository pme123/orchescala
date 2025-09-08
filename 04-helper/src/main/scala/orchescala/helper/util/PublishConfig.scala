package orchescala.helper.util

import sttp.tapir.Schema.annotations.description

case class PublishConfig(
    documentationUrl: String,
    documentationEnvUsername: String = "DOCUMENTATION_USERNAME",
    documentationEnvPassword: String = "DOCUMENTATION_PASSWORD",
    openApiHtmlPath: os.ResourcePath = os.resource / "OpenApi.html",
    @description(
      "Path to the home.html - if you want to publish a home page - the base page for all catalogs. Contains links to all Catalogs."
    )
    homeHtmlPath: Option[os.ResourcePath] = None
)
