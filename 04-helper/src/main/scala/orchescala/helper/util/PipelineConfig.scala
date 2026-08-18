package orchescala.helper.util

import sttp.tapir.Schema.annotations.description

case class PipelineConfig(
    // GitLab CI configs
    @description("The base image the pipeline runs in GitLab.")
    baseImage: String,
    @description(
      "The base proxy url for the pipeline to access the internet. If not set, the pipeline will not use a proxy."
    )
    baseProxy: String,
    @description(
      "The Env Variable of the Library Repo User (Artifactory). Default is '{COMPANY}_MVN_REPOSITORY_USERNAME'."
    )
    companyMVNUserEnv: Option[String] = None,
    @description(
      "The Env Variable of the Library Repo Password (Artifactory). Default is '{COMPANY}_MVN_REPOSITORY_PASSWORD'."
    )
    companyMVNPasswordEnv: Option[String] = None
)
