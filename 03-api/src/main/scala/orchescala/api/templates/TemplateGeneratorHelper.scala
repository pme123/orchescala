package orchescala.api.templates

import orchescala.domain.*
import orchescala.api.*

/**
 * Shared helper class containing common functionality for template generation
 * that can be reused by both C7 and C8 implementations.
 */
class TemplateGeneratorHelper(
    val config: ModelerTemplateConfig,
    val projectName: String,
    val companyName: String,
    val apiVersion: String
):
  
  lazy val version: Int = apiVersion.split("\\.").head.toInt
  
  /**
   * Creates the template directory if it doesn't exist
   */
  def ensureTemplateDirectory(): Unit =
    os.makeDir.all(config.templatePath)
  
  /**
   * Generates a clean nice name by removing company prefix
   */
  def generateNiceName(inOut: InOut[?, ?, ?]): String =
    inOut.niceName.split(" ")
      .last
      .niceName
      .trim
  
  /**
   * Extracts description from the InOut object
   */
  def extractDescription(inOut: InOut[?, ?, ?]): String =
    inOut.descr.getOrElse("").split("---").head
  
  /**
   * Determines if an API is supported for template generation
   */
  def isApiSupported(api: InOutApi[?, ?]): Boolean = api match
    case _: ExternalTaskApi[?, ?] => true
    case _: ProcessApi[?, ?, ?]   => true
    case _                        => false
  

  /**
   * Logs the generation status for an API
   */
  def logApiGeneration(api: InOutApi[?, ?], camundaVersion: String, supported: Boolean): Unit =
    if supported then
      println(s"${api.getClass.getSimpleName} supported for $camundaVersion Modeler Template: ${api.id}")
    else
      println(s"API NOT supported for $camundaVersion Modeler Template: ${api.getClass.getSimpleName} - ${api.id}")

end TemplateGeneratorHelper
