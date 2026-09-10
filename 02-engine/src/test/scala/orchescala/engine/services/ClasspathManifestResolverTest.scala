package orchescala.engine.services

import munit.FunSuite
import orchescala.engine.domain.{DeploymentEntry, DeploymentResourceType}
import zio.{Runtime, Unsafe}

class ClasspathManifestResolverTest extends FunSuite:

  private def unsafeRun[A](effect: zio.IO[?, A]): A =
    Unsafe.unsafe: unsafe ?=>
      Runtime.default.unsafe.run(effect).getOrThrowFiberFailure()(using unsafe)

  test("resolves resources from classpath"):
    val entry    = DeploymentEntry("mycompany", "myproject", "1.2.0")
    val resolver = ClasspathManifestResolver("deployments")
    val resources = unsafeRun(resolver.resolve(entry).mapError(err => RuntimeException(err.errorMsg)))

    assertEquals(resources.size, 2)
    assert(resources.exists(_.name == "process.bpmn"))
    assert(resources.exists(_.name == "decision.dmn"))
    assertEquals(
      resources.find(_.name == "process.bpmn").get.resourceType,
      DeploymentResourceType.Bpmn
    )
    assertEquals(
      resources.find(_.name == "decision.dmn").get.resourceType,
      DeploymentResourceType.Dmn
    )
    assert(resources.forall(_.content.nonEmpty))

  test("returns empty result for unknown entry"):
    val entry    = DeploymentEntry("unknown", "project", "1.0.0")
    val resolver = ClasspathManifestResolver("deployments")
    val resources = unsafeRun(resolver.resolve(entry).mapError(err => RuntimeException(err.errorMsg)))
    assertEquals(resources, Seq.empty)
end ClasspathManifestResolverTest
