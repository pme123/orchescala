package orchescala.engine.gateway.http

import java.nio.file.{Files, Paths, StandardOpenOption}

/** Standalone application to generate the OpenAPI YAML specification.
  * 
  * This is intended to be run from sbt during the build process to generate
  * the openapi.yml file in the resources directory.
  */
object GenerateOpenApiYaml:

  def main(args: Array[String]): Unit =
    val yaml = OpenApiGenerator.generateYaml
    
    // Write to resources directory
    val outputPath = Paths.get("05-engine-gateway/src/main/resources/openapi.yml")
    
    // Ensure parent directory exists
    Files.createDirectories(outputPath.getParent)
    
    // Write the YAML file
    Files.writeString(
      outputPath,
      yaml,
      StandardOpenOption.CREATE,
      StandardOpenOption.TRUNCATE_EXISTING
    )
    
    println(s"✓ OpenAPI specification generated at: ${outputPath.toAbsolutePath}")

end GenerateOpenApiYaml

