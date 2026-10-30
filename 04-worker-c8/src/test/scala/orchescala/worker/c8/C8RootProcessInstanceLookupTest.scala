package orchescala.worker.c8

import io.camunda.client.api.command.ClientHttpException
import munit.FunSuite
import orchescala.worker.c8.C8Worker.ProcessInstanceNotFound
import zio.*

import java.util.concurrent.atomic.AtomicInteger

// The cache of the roots is shared by all tests - each test uses its own process instance keys.
class C8RootProcessInstanceLookupTest extends FunSuite:

  private def run[A](effect: IO[String, A]): Either[String, A] =
    Unsafe.unsafe(implicit unsafe => Runtime.default.unsafe.run(effect.either).getOrThrowFiberFailure())

  private val noWait = Schedule.recurs(3)

  // the lookup counts its calls; `answer` gets the number of the call
  private def counting(answer: Int => Task[Option[Long]]): (AtomicInteger, Long => Task[Option[Long]]) =
    val lookups = AtomicInteger(0)
    (lookups, (_: Long) => ZIO.succeed(lookups.incrementAndGet()).flatMap(answer))

  test("the root of the job is taken as it is - no lookup"):
    val (lookups, lookup) = counting(_ => ZIO.some(9L))
    assertEquals(run(C8Worker.rootProcessInstanceId(Some(1L), 2L, Some(lookup), noWait)), Right(Some("1")))
    assertEquals(lookups.get, 0)

  test("a job without root (gRPC activation): looked up once per process instance"):
    val (lookups, lookup) = counting(_ => ZIO.some(100L))
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 101L, Some(lookup), noWait)), Right(Some("100")))
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 101L, Some(lookup), noWait)), Right(Some("100")))
    assertEquals(lookups.get, 1)

  test("a sub process not yet in the engine's search data (404): tried again"):
    val (lookups, lookup) = counting(n => if n < 3 then ZIO.fail(ProcessInstanceNotFound(201L)) else ZIO.some(200L))
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 201L, Some(lookup), noWait)), Right(Some("200")))
    assertEquals(lookups.get, 3)

  test("not found after the retries: an error naming the process instance"):
    val (lookups, lookup) = counting(_ => ZIO.fail(ProcessInstanceNotFound(301L)))
    val result            = run(C8Worker.rootProcessInstanceId(None, 301L, Some(lookup), noWait))
    assert(result.left.exists(e => e.contains("'301'") && e.contains("not found")), result)
    assertEquals(lookups.get, 4) // the first try and the 3 retries of `noWait`

  test("another error (auth, connection, timeout): not tried again, the error says what it was"):
    val (lookups, lookup) = counting(_ => ZIO.fail(ClientHttpException(401, "Unauthorized")))
    val result            = run(C8Worker.rootProcessInstanceId(None, 501L, Some(lookup), noWait))
    assertEquals(lookups.get, 1)
    assert(result.left.exists(e => e.contains("'501'") && e.contains("Unauthorized") && !e.contains("not found")), result)

  test("the engine knows no root: no root, and it is not cached - the next job asks again"):
    val (lookups, lookup) = counting(_ => ZIO.none)
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 601L, Some(lookup), noWait)), Right(None))
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 601L, Some(lookup), noWait)), Right(None))
    assertEquals(lookups.get, 2)

  test("only a 404 of the engine becomes ProcessInstanceNotFound"):
    assertEquals(C8Worker.notFoundAs(701L)(ClientHttpException(404, "Not Found")), ProcessInstanceNotFound(701L))
    val serverError = ClientHttpException(500, "Internal Server Error")
    assertEquals(C8Worker.notFoundAs(701L)(serverError), serverError)
    val timeout = RuntimeException("timed out waiting on client response")
    assertEquals(C8Worker.notFoundAs(701L)(timeout), timeout)

  test("no CamundaClient: no root"):
    assertEquals(run(C8Worker.rootProcessInstanceId(None, 401L, None, noWait)), Right(None))

end C8RootProcessInstanceLookupTest
