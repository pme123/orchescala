package orchescala.worker.c8

import munit.FunSuite

class C8ClusterVersionTest extends FunSuite:

  test("a cluster before 8.10 is reported - camunda.processInstance.key is unknown there"):
    assert(C8WorkerRegistry.before810("8.9.21"))
    assert(C8WorkerRegistry.before810("8.8.0"))
    assert(C8WorkerRegistry.before810("7.24.0"))
    assert(!C8WorkerRegistry.before810("8.10.0"))
    assert(!C8WorkerRegistry.before810("8.10.8"))
    assert(!C8WorkerRegistry.before810("8.11.0-SNAPSHOT"))
    assert(!C8WorkerRegistry.before810("9.0.0"))
    // unknown: no warning
    assert(!C8WorkerRegistry.before810(""))
    assert(!C8WorkerRegistry.before810(null))
    assert(!C8WorkerRegistry.before810("abc"))
    assert(!C8WorkerRegistry.before810("99999999999.1"))

end C8ClusterVersionTest
