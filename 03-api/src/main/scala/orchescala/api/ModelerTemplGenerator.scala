package orchescala.api

import orchescala.domain.*
import orchescala.api.templates.{ModelerTemplateGenerator, C7TemplateGenerator, C8TemplateGenerator}

/**
 * Refactored ModelerTemplGenerator that uses the new interface and implementations
 */
final case class ModelerTemplGenerator(
    apiVersion: String,
    configs: Seq[ModelerTemplateConfig],
    projectName: String,
    companyName: String
):

  private def generator(config: ModelerTemplateConfig) =
    config.supportedEngine match
      case SupportedEngine.C7 => C7TemplateGenerator(config, projectName, companyName, apiVersion)
      case SupportedEngine.C8 => C8TemplateGenerator(config, projectName, companyName, apiVersion)
      case SupportedEngine.Op => C7TemplateGenerator(config, projectName, companyName, apiVersion)

  lazy val version = apiVersion.split("\\.").head.toInt

  def generate(apis: List[InOutApi[?, ?]]): Unit =
    configs.foreach: config =>
      generator(config).generate(apis)
  end generate

end ModelerTemplGenerator
