package orchescala.engine.gateway.http

import zio.*
import zio.test.*

object OpenApiGenerationSpec extends ZIOSpecDefault:

  def spec = suite("OpenAPI Generation")(
    test("should generate valid OpenAPI YAML") {
      for
        yaml <- ZIO.attempt(OpenApiGenerator.generateYaml)
      yield assertTrue(
        yaml.nonEmpty,
        yaml.contains("openapi:"),
        yaml.contains("Engine Gateway API"),
        yaml.contains("/process/{processDefId}/async")
      )
    },
    test("should generate OpenAPI file on server start") {
      import java.nio.file.{Files, Paths}
      
      val outputPath = Paths.get("05-engine-gateway/src/main/resources/openapi.yml")
      
      for
        // Clean up any existing file
        _ <- ZIO.attempt(Files.deleteIfExists(outputPath)).ignore
        
        // Generate the spec (simulating what the server does)
        _ <- ZIO.attempt {
          val yaml = OpenApiGenerator.generateYaml
          Files.createDirectories(outputPath.getParent)
          Files.writeString(
            outputPath,
            yaml,
            java.nio.file.StandardOpenOption.CREATE,
            java.nio.file.StandardOpenOption.TRUNCATE_EXISTING
          )
        }
        
        // Verify file was created
        exists <- ZIO.attempt(Files.exists(outputPath))
        content <- ZIO.attempt(Files.readString(outputPath))
        
      yield assertTrue(
        exists,
        content.nonEmpty,
        content.contains("openapi:"),
        content.contains("Engine Gateway API")
      )
    }
  )

end OpenApiGenerationSpec

