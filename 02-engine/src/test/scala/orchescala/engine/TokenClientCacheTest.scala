package orchescala.engine

import munit.FunSuite

import scala.collection.mutable

class TokenClientCacheTest extends FunSuite:

  private class FakeClient(val token: String)

  private def cache(idleTtlMillis: Long, closed: mutable.Buffer[String]) =
    TokenClientCache[FakeClient](
      build = FakeClient(_),
      close = c => closed += c.token,
      idleTtlMillis = idleTtlMillis,
      clientTypeName = "test"
    )

  test("one client per token, reused for the same token"):
    val closed = mutable.Buffer.empty[String]
    val c      = cache(60_000, closed)
    val a1     = c.get("a")
    val a2     = c.get("a")
    val b      = c.get("b")
    assert(a1 eq a2)
    assert(!(a1 eq b))
    assertEquals(c.size, 2)
    assert(closed.isEmpty)

  test("idle clients are closed and dropped on the next access"):
    val closed = mutable.Buffer.empty[String]
    val c      = cache(0, closed)
    c.get("a")
    Thread.sleep(2)
    c.get("b") // 'a' is now idle for >= 0 ms -> evicted before 'b' is added
    assertEquals(closed.toList, List("a"))
    assertEquals(c.size, 1)

  test("closeAll closes every cached client and empties the cache"):
    val closed = mutable.Buffer.empty[String]
    val c      = cache(60_000, closed)
    c.get("a")
    c.get("b")
    c.closeAll()
    assertEquals(closed.sorted.toList, List("a", "b"))
    assertEquals(c.size, 0)

  test("a failing close does not break eviction"):
    val c = TokenClientCache[FakeClient](
      build = FakeClient(_),
      close = _ => throw RuntimeException("boom"),
      idleTtlMillis = 0,
      clientTypeName = "test"
    )
    c.get("a")
    Thread.sleep(2)
    val b = c.get("b")
    assertEquals(b.token, "b")
    assertEquals(c.size, 1)

end TokenClientCacheTest
