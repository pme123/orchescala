package orchescala.api

import munit.FunSuite

class VersionHelperTest extends FunSuite:

  test("repoSearch".ignore):
    assertEquals(
      VersionHelper.repoSearch("orchescala-api_3", "io.github.pme123"),
      "1.30.28" // This is the latest released version
    )

  test("repoSearch no result".ignore):
    assertEquals(
      VersionHelper.repoSearch("orchescala-apix_3", "io.github.pme123"),
      "VERSION NOT FOUND"
    )
end VersionHelperTest
