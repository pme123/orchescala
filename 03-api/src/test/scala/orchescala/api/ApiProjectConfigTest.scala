package orchescala.api

import munit.FunSuite

class ApiProjectConfigTest extends FunSuite:
  test("ApiProjectConfig".ignore): // needs coursier
    val apiProjectConfig = ApiProjectConfig(
      os.pwd / "03-api" / "src" / "test" / defaultProjectConfigPath
    )
    assertEquals(
      apiProjectConfig,
      ApiProjectConfig(
        "mycompany-myProject",
        VersionConfig("1.0.0-SNAPSHOT"),
        Seq("subProject1", "subProject2"),
        Seq(
          DependencyConfig("mastercompany-services"),
          DependencyConfig("mycompany-commons")
        ),
        Seq.empty
      )
    )

end ApiProjectConfigTest
