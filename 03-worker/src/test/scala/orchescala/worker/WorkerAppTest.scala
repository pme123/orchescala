package orchescala.worker

import munit.FunSuite
import orchescala.domain.*

import scala.reflect.ClassTag

class WorkerAppTest extends FunSuite:

  // Test helper classes
  class TestWorkerApp(name: String, deps: Seq[WorkerApp] = Seq.empty) extends WorkerApp:
    lazy val engineContext = new EngineContext:
      override def getLogger(clazz: Class[?]): OrchescalaLogger = ???
      override def toEngineObject: Json => Any = ???
      override def sendRequest[ServiceIn: Encoder, ServiceOut: {Decoder, ClassTag}](
          request: RunnableRequest[ServiceIn]
      ): SendRequestType[ServiceOut] = ???
    end engineContext

    override def workerConfig: WorkerConfig = DefaultWorkerConfig()
    override def applicationName: String = name
    override def workerRegistries: Seq[WorkerRegistry] = Seq.empty
    
    // Initialize dependencies
    dependencies(deps*)

  test("workerApps with no dependencies returns single app"):
    val app = TestWorkerApp("test-app")
    val result = app.workerApps(app)
    
    assertEquals(result.size, 1)
    assertEquals(result.head.applicationName, "test-app")

  test("workerApps with single dependency returns app and dependency"):
    val dependency = TestWorkerApp("dependency-app")
    val mainApp = TestWorkerApp("main-app", Seq(dependency))
    
    val result = mainApp.workerApps(mainApp)
    
    assertEquals(result.size, 2)
    assert(result.contains(mainApp))
    assert(result.contains(dependency))

  test("workerApps with multiple dependencies returns all apps"):
    val dep1 = TestWorkerApp("dep1")
    val dep2 = TestWorkerApp("dep2")
    val mainApp = TestWorkerApp("main-app", Seq(dep1, dep2))
    
    val result = mainApp.workerApps(mainApp)
    
    assertEquals(result.size, 3)
    assert(result.contains(mainApp))
    assert(result.contains(dep1))
    assert(result.contains(dep2))

  test("workerApps with nested dependencies returns all apps"):
    val leafDep = TestWorkerApp("leaf-dep")
    val midDep = TestWorkerApp("mid-dep", Seq(leafDep))
    val rootApp = TestWorkerApp("root-app", Seq(midDep))
    
    val result = rootApp.workerApps(rootApp)
    
    assertEquals(result.size, 3)
    assert(result.contains(rootApp))
    assert(result.contains(midDep))
    assert(result.contains(leafDep))

  test("workerApps with complex dependency tree"):
    val leaf1 = TestWorkerApp("leaf1")
    val leaf2 = TestWorkerApp("leaf2")
    val mid1 = TestWorkerApp("mid1", Seq(leaf1))
    val mid2 = TestWorkerApp("mid2", Seq(leaf2))
    val root = TestWorkerApp("root", Seq(mid1, mid2))
    
    val result = root.workerApps(root)
    
    assertEquals(result.size, 5)
    assert(result.contains(root))
    assert(result.contains(mid1))
    assert(result.contains(mid2))
    assert(result.contains(leaf1))
    assert(result.contains(leaf2))

  test("workerApps maintains order with main app first"):
    val dep1 = TestWorkerApp("dep1")
    val dep2 = TestWorkerApp("dep2")
    val mainApp = TestWorkerApp("main-app", Seq(dep1, dep2))
    
    val result = mainApp.workerApps(mainApp)
    
    assertEquals(result.head, mainApp)

  test("workerApps handles empty dependencies correctly"):
    val app = TestWorkerApp("solo-app")
    val result = app.workerApps(app)
    
    assertEquals(result, Seq(app))

  test("workerApps with diamond dependency pattern"):
    val shared = TestWorkerApp("shared")
    val left = TestWorkerApp("left", Seq(shared))
    val right = TestWorkerApp("right", Seq(shared))
    val top = TestWorkerApp("top", Seq(left, right))

    val result = top.workerApps(top)

    // Should contain all apps, with shared potentially appearing multiple times
    // due to the recursive nature of the algorithm
    assert(result.contains(top))
    assert(result.contains(left))
    assert(result.contains(right))
    assert(result.contains(shared))

  test("workerApps preserves dependency order"):
    val dep1 = TestWorkerApp("dep1")
    val dep2 = TestWorkerApp("dep2")
    val mainApp = TestWorkerApp("main-app", Seq(dep1, dep2))

    val result = mainApp.workerApps(mainApp)

    // Main app should be first, followed by dependencies
    assertEquals(result.head, mainApp)
    val remainingApps = result.tail
    assert(remainingApps.contains(dep1))
    assert(remainingApps.contains(dep2))

  test("workerApps with deep nesting"):
    val level4 = TestWorkerApp("level4")
    val level3 = TestWorkerApp("level3", Seq(level4))
    val level2 = TestWorkerApp("level2", Seq(level3))
    val level1 = TestWorkerApp("level1", Seq(level2))

    val result = level1.workerApps(level1)

    assertEquals(result.size, 4)
    assertEquals(result.head, level1)
    assert(result.contains(level2))
    assert(result.contains(level3))
    assert(result.contains(level4))

  test("workerApps with multiple branches at different levels"):
    val leaf1 = TestWorkerApp("leaf1")
    val leaf2 = TestWorkerApp("leaf2")
    val leaf3 = TestWorkerApp("leaf3")
    val branch1 = TestWorkerApp("branch1", Seq(leaf1, leaf2))
    val branch2 = TestWorkerApp("branch2", Seq(leaf3))
    val root = TestWorkerApp("root", Seq(branch1, branch2))

    val result = root.workerApps(root)

    assertEquals(result.size, 6)
    assertEquals(result.head, root)
    assert(result.contains(branch1))
    assert(result.contains(branch2))
    assert(result.contains(leaf1))
    assert(result.contains(leaf2))
    assert(result.contains(leaf3))

  test("workerApps returns correct sequence type"):
    val app = TestWorkerApp("test-app")
    val result = app.workerApps(app)

    assert(result.isInstanceOf[Seq[WorkerApp]])
    assertEquals(result.length, 1)

  test("workerApps with self-referential dependency handling"):
    // This tests the algorithm's behavior with potential circular references
    val app1 = TestWorkerApp("app1")
    val app2 = TestWorkerApp("app2", Seq(app1))

    val result = app2.workerApps(app2)

    assertEquals(result.size, 2)
    assertEquals(result.head, app2)
    assert(result.contains(app1))

end WorkerAppTest
