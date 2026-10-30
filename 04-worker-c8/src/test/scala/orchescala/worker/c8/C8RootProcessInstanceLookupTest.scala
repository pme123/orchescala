package orchescala.worker.c8

import munit.FunSuite
import zio.*

import java.util.concurrent.atomic.AtomicInteger

class C8RootProcessInstanceLookupTest extends FunSuite:

  private def run[A](effect: IO[String, A]): Either[String, A] =
    Unsafe.unsafe(implicit unsafe => Runtime.default.unsafe.run(effect.either).getOrThrowFiberFailure())

  private val noWait = Schedule.recurs(3)

  test("the root of the job is taken as it is - no lookup"):
    val lookups = AtomicInteger(0)
    val lookup  = (_: Long) => ZIO.succeed(lookups.incrementAndGet()).as(Some(9L))
    assertEquals(run(C8Worker.rootProcessInstanceId(Some(1L), 2L, Some(lookup), noWait)), Right(Some("1")))
    assertEquals(lookups.get, 0)

  test("a job without root (gRPC activation): looked up once per process instance"):
    val lookups = AtomicInteger(0)
    val lookup  = (_: Long) => ZIO.succeed(lookups.incrementAndGet()).as(Some(100L))
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 101L, Some(lookup), noWait)), Right(Some("100")))
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 101L, Some(lookup), noWait)), Right(Some("100")))
    assertEquals(lookups.get, 1)

  test("a sub process not yet in the engine's search data: tried again"):
    val lookups = AtomicInteger(0)
    val lookup  = (_: Long) =>
      ZIO.succeed(lookups.incrementAndGet()).flatMap: n =>
        if n < 3 then ZIO.fail(RuntimeException("404 Not Found")) else ZIO.some(200L)
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 201L, Some(lookup), noWait)), Right(Some("200")))
    assertEquals(lookups.get, 3)

  test("not found after the retries: an error naming the process instance"):
    val lookup = (_: Long) => ZIO.fail(RuntimeException("404 Not Found"))
    val result = run(C8Worker.rootProcessInstanceId(None, 301L, Some(lookup), noWait))
    assert(result.left.exists(_.contains("'301'")), result)

  test("no CamundaClient: no root"):
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 401L, None, noWait)), Right(None))

end C8RootProcessInstanceLookupTest
