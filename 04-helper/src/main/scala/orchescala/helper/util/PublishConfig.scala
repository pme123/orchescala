package orchescala.helper.util

import sttp.tapir.Schema.annotations.description

case class PublishConfig(
    documentationUrl: String,
    documentationEnvUsername: String = "DOCUMENTATION_USERNAME",
    documentationEnvPassword: String = "DOCUMENTATION_PASSWORD",
    @description(
      "Local checkout path of the orch-doc app (z9nai/orch-doc) - needed on the machine that runs the company's `update` (builds the single-file API page into `apiHtmlResource`), `prepareDocs` and `publishDocs`."
    )
    apiDocPath: Option[os.Path] = None,
    @description(
      "orch-doc's single-file API page, shipped as resource of the COMPANY helper (the company's `update` builds and copies it there from `apiDocPath`). If it exists, every project's `update` writes it as `03-api/OpenApi.html` and `03-api/PostmanOpenApi.html` instead of the Redoc shells - the page derives its yml from its own file name."
    )
    apiHtmlResource: os.ResourcePath = os.resource / "OrchDocApi.html"
)
