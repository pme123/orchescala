package orchescala.helper.dev

import munit.FunSuite
import orchescala.helper.dev.update.SbtSettingsGenerator
import orchescala.helper.util.{DevConfig, ModuleConfig}

/** The generated builds must point to the DMN Tester - the `dmn` module is
  * only the DSL since the tester moved into orchescala.
  */
class DmnDepsGeneratorTest extends FunSuite:

  private given DevConfig = DevConfig.init(
    os.pwd / "04-helper" / "src" / "test" / "resources" / "PROJECT.conf"
  )

  test("the dmn module pulls the tester, other modules stay as they are"):
    assertEquals(
      ModuleConfig.dmnModule.orchescalaArtifactNames,
      Seq("dmntester-server")
    )
    assertEquals(ModuleConfig.apiModule.orchescalaArtifactNames, Seq("api"))
    assertEquals(ModuleConfig.domainModule.orchescalaArtifactNames, Seq("domain"))

  test("a project's dmnDeps depend on orchescala-dmntester-server"):
    val generated = SbtSettingsGenerator(isGateway = false).sbtDependencies
    val dmnDeps = generated
      .linesIterator
      .dropWhile(!_.contains("lazy val dmnDeps"))
      .takeWhile(!_.contains("lazy val simulationDeps"))
      .mkString("\n")
    assert(
      dmnDeps.contains(""""io.github.pme123" %% "orchescala-dmntester-server" % orchescalaV"""),
      dmnDeps
    )
    // the DMN engine's geny_2.13 must not reach a project build
    assert(dmnDeps.contains(""".exclude("com.lihaoyi", "geny_2.13")"""), dmnDeps)
    assert(
      !dmnDeps.contains(""""io.github.pme123" %% "orchescala-dmn" % orchescalaV"""),
      s"the DSL comes transitively:\n$dmnDeps"
    )
    // the company artifact stays the same
    assert(dmnDeps.contains("""customer %% s"$customer-orchescala-dmn""""), dmnDeps)
    // other modules must not have changed
    assert(
      generated.contains(""""io.github.pme123" %% "orchescala-api" % orchescalaV"""),
      generated
    )

end DmnDepsGeneratorTest
