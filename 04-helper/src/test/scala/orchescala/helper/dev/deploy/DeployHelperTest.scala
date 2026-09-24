package orchescala.helper.dev.deploy

import munit.FunSuite

class DeployHelperTest extends FunSuite:

  test("unwraps the Postman API response for newman"):
    assertEquals(
      DeployHelper.unwrapPostman("collection", """{"collection":{"info":{"name":"c"},"item":[]}}"""),
      Right("""{"info":{"name":"c"},"item":[]}""")
    )
    assertEquals(
      DeployHelper.unwrapPostman("environment", """{"environment":{"name":"e","values":[]}}"""),
      Right("""{"name":"e","values":[]}""")
    )

  test("a Postman error response is reported, not written as collection"):
    assert(DeployHelper.unwrapPostman("collection", """{"error":{"name":"notFound"}}""").isLeft)
    assert(DeployHelper.unwrapPostman("collection", "<html>").isLeft)

end DeployHelperTest
