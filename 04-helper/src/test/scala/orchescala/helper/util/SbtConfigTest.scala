package orchescala.helper.util

import munit.FunSuite

class SbtConfigTest extends FunSuite:

  test("the docker images are built for amd64 (OpenShift) by default - also on Apple Silicon"):
    val settings = SbtConfig.dockerBuildSettings(SbtConfig().dockerBuildOptions)
    assert(
      settings.contains("""dockerBuildOptions ++= Seq("--platform", "linux/amd64")"""),
      settings
    )
    assert(settings.contains("lazy val dockerBuildSettings"), settings)

  test("no options: an empty setting, so `dockerSettings` still compiles"):
    val settings = SbtConfig.dockerBuildSettings(Seq.empty)
    assert(settings.contains("lazy val dockerBuildSettings: Seq[Setting[_]] = Seq()"), settings)
    assert(!settings.contains("dockerBuildOptions ++="), settings)

end SbtConfigTest
