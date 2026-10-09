package orchescala.helper.dev.company.docs

import munit.FunSuite

class DocCreatorTest extends FunSuite:

  test("byProject - the BPMN and the worker version of a project in one group, in that order"):
    val groups = DocCreator.byProject(Map(
      "acme-shop-worker" -> "1.1.0",
      "acme-shop"        -> "1.0.0",
      "acme-cards"       -> "2.0.0",
      "acme-worker-pool" -> "0.1.0" // «worker» inside the name: a project of its own
    ))
    assertEquals(groups.map(_._1), Seq("acme-cards", "acme-shop", "acme-worker-pool"))
    val shop = groups.find(_._1 == "acme-shop").get._2
    assertEquals(shop.map(v => v.name -> v.isWorker), Seq("acme-shop" -> false, "acme-shop-worker" -> true))
    assertEquals(groups.find(_._1 == "acme-worker-pool").get._2.map(_.isWorker), Seq(false))

  test("failureOf - only releases missing: a ReleaseNotFound; else the first other error, the rest suppressed"):
    import orchescala.helper.dev.company.docs.site.ReleaseNotFound
    assertEquals(DocCreator.failureOf(Seq.empty), None)
    val missing  = ReleaseNotFound("no acme-shop-v1.0.0")
    val missing2 = ReleaseNotFound("no acme-cards-v2.0.0")
    val onlyMissing = DocCreator.failureOf(Seq("acme-shop" -> missing, "acme-cards" -> missing2)).get
    assert(onlyMissing.isInstanceOf[ReleaseNotFound])
    assert(onlyMissing.getCause eq missing)
    assert(onlyMissing.getMessage.contains("2 version(s)") && onlyMissing.getMessage.contains("acme-cards: no acme-cards-v2.0.0"))
    val broken = new Exception("tar failed")
    val mixed  = DocCreator.failureOf(Seq("acme-shop" -> missing, "acme-cards" -> broken)).get
    assert(!mixed.isInstanceOf[ReleaseNotFound])
    assert(mixed.getCause eq broken)
    assertEquals(mixed.getSuppressed.toSeq, Seq(missing))

end DocCreatorTest
