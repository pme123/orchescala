package orchescala.api.templates

import orchescala.api.InOutApi
import orchescala.domain.*

/**
 * Interface for generating modeler templates for different Camunda versions.
 * Provides abstraction over C7 and C8 template generation.
 */
trait ModelerTemplateGenerator:
  
  /**
   * Generate templates for the given APIs
   * @param apis List of APIs to generate templates for
   */
  def generate(apis: List[InOutApi[?, ?]]): Unit
  
  /**
   * The Camunda version this generator supports
   */
  def version: Int
  
  /**
   * The project name for template generation
   */
  def projectName: String
  
  /**
   * The company name for template generation
   */
  def companyName: String

end ModelerTemplateGenerator
