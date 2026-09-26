package orchescala.worker.c7

import munit.FunSuite
import org.camunda.bpm.client.task.{ExternalTask, ExternalTaskService}
import org.camunda.bpm.client.task.impl.ExternalTaskImpl

import java.util.Map as JMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.{ConcurrentLinkedQueue, CountDownLatch, Executors, TimeUnit}
import scala.jdk.CollectionConverters.*

class GuardedExternalTaskServiceTest extends FunSuite:

  /** Records the calls and how many ran at the same time - as the engine, a call takes 50ms. */
  private class RecordingService extends ExternalTaskService:
    val calls      = ConcurrentLinkedQueue[String]()
    val running    = AtomicInteger(0)
    val maxRunning = AtomicInteger(0)
    private def call(name: String): Unit =
      maxRunning.accumulateAndGet(running.incrementAndGet(), math.max)
      Thread.sleep(50)
      calls.add(name)
      running.decrementAndGet()
    def extendLock(t: ExternalTask, d: Long): Unit                                         = call("extendLock")
    def extendLock(id: String, d: Long): Unit                                               = call("extendLock")
    def complete(t: ExternalTask): Unit                                                     = call("complete")
    def complete(t: ExternalTask, v: JMap[String, Object]): Unit                            = call("complete")
    def complete(t: ExternalTask, v: JMap[String, Object], l: JMap[String, Object]): Unit   = call("complete")
    def complete(id: String, v: JMap[String, Object], l: JMap[String, Object]): Unit        = call("complete")
    def unlock(t: ExternalTask): Unit                                                       = call("unlock")
    def handleFailure(t: ExternalTask, m: String, d: String, r: Int, rt: Long): Unit        = call("handleFailure")
    def handleFailure(id: String, m: String, d: String, r: Int, rt: Long): Unit             = call("handleFailure")
    def handleFailure(id: String, m: String, d: String, r: Int, rt: Long, v: JMap[String, Object], l: JMap[String, Object]): Unit =
      call("handleFailure")
    def handleBpmnError(t: ExternalTask, c: String): Unit                                   = call("handleBpmnError")
    def handleBpmnError(t: ExternalTask, c: String, m: String): Unit                        = call("handleBpmnError")
    def handleBpmnError(t: ExternalTask, c: String, m: String, v: JMap[String, Object]): Unit = call("handleBpmnError")
    def handleBpmnError(id: String, c: String, m: String, v: JMap[String, Object]): Unit    = call("handleBpmnError")
    def lock(id: String, d: Long): Unit                                                     = call("lock")
    def lock(t: ExternalTask, d: Long): Unit                                                = call("lock")
    def setVariables(id: String, v: JMap[String, Object]): Unit                             = call("setVariables")
    def setVariables(t: ExternalTask, v: JMap[String, Object]): Unit                        = call("setVariables")
  end RecordingService

  private val task = ExternalTaskImpl()

  test("lock renewal and completion never overlap"):
    val engine   = RecordingService()
    val guarded  = GuardedExternalTaskService(engine)
    val pool     = Executors.newFixedThreadPool(2)
    val start    = CountDownLatch(1)
    pool.execute(() => { start.await(); guarded.extendLock(task, 60_000) })
    pool.execute(() => { start.await(); guarded.complete(task, JMap.of()) })
    start.countDown()
    pool.shutdown()
    assert(pool.awaitTermination(5, TimeUnit.SECONDS))
    assertEquals(engine.maxRunning.get, 1) // before: extendLock and complete at the same time

  test("no lock renewal after the task is completed"):
    val engine  = RecordingService()
    val guarded = GuardedExternalTaskService(engine)
    guarded.complete(task, JMap.of())
    guarded.extendLock(task, 60_000)
    assertEquals(engine.calls.asScala.toSeq, Seq("complete"))

end GuardedExternalTaskServiceTest
