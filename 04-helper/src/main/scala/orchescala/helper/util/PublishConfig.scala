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
    homeHtmlPath: Option[os.ResourcePath] = None,
    @description(
      "Local checkout path of the orch-doc app (z9nai/orch-doc). When set, its build replaces the static OpenApi.html as the per-project API doc. First, non-final integration step."
    )
    apiDocPath: Option[os.Path] = None
)
