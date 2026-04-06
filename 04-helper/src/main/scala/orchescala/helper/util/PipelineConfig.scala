package orchescala.helper.util

case class PipelineConfig (
  // GitLab CI configs
  baseImage: String,
  baseProxy: String,
  companyMVNUser: String,
  companyMVNPassword: String
)
