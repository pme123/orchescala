package orchescala.helper.util

/** Where the documentation is published (WebDAV) and the credentials for it. Everything the site
  * is built from - the documentation app, orch-spec, its tools - ships in the orchescala jars.
  */
case class PublishConfig(
    documentationUrl: String,
    documentationEnvUsername: String = "DOCUMENTATION_USERNAME",
    documentationEnvPassword: String = "DOCUMENTATION_PASSWORD"
)
