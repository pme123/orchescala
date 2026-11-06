package orchescala.helper.dev.company.docs

import munit.FunSuite
import orchescala.api.*

/** The dependency cell of the release tables and the dependency check - which dependency is in the
  * release, on another minor, or on a project missing in VERSIONS.conf.
  */
class DependencyValidatorTest extends FunSuite:

  private def conf(name: String, version: String, deps: Seq[(String, String)] = Seq.empty, isWorker: Boolean = false) =
    DocProjectConfig(
      ApiProjectConfig(
        name,
        VersionConfig(version),
        Seq.empty,
        deps.map((n, v) => DependencyConfig(n, VersionConfig(v))),
        Seq.empty,
        ModuleType.projectModules
      ),
      version,
      Seq.empty,
      isWorker
    )

  private val base       = conf("acme-base", "2.31.3")
  private val onRelease  = conf("acme-shop", "1.0.0", Seq("acme-base" -> "2.31.0"))
  private val onOlder    = conf("acme-cards", "3.0.0", Seq("acme-base" -> "2.30.0"))
  private val worker     = conf("acme-cards", "3.0.1", Seq("acme-base" -> "2.30.0"), isWorker = true)
  private val onMissing  = conf("acme-loans", "1.2.0", Seq("acme-gone" -> "1.0.0"))
  private val standalone = conf("acme-admin", "1.0.0")

  test("dependencyCell - the release version for the release's minor, else the declared minor"):
    assertEquals(DocCreator.dependencyCell(onRelease, base), "2.31.3")
    assertEquals(DocCreator.dependencyCell(onOlder, base), "2.30.*")
    assertEquals(DocCreator.dependencyCell(standalone, base), "")

  test("dependencyCell - a worker takes the newest version: always the release's"):
    assertEquals(DocCreator.dependencyCell(worker, base), "2.31.3")

  test("dependencyFailures - another minor is told apart from a project missing in VERSIONS.conf"):
    val (missing, otherMinor) =
      DependencyValidator.dependencyFailures(Seq(base, onRelease, onOlder, worker, onMissing, standalone))
    assertEquals(missing, Seq("acme:acme-loans:1.2.0" -> Seq("acme:acme-gone:1.0.0")))
    // the worker on 2.30 is not reported - it takes the newest version
    assertEquals(otherMinor, Seq("acme:acme-cards:3.0.0" -> Seq("acme:acme-base:2.30.0")))

  test("dependencyFailures - none if all dependencies are in the release"):
    assertEquals(DependencyValidator.dependencyFailures(Seq(base, onRelease)), (Seq.empty, Seq.empty))

end DependencyValidatorTest
