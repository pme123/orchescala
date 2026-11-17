package orchescala.helper.util

import munit.FunSuite
import orchescala.BuildInfo

/** The `//> using` lines of the generated scala-cli scripts - all of them come from here. */
class ScalaCliDirectivesTest extends FunSuite:

  test("the Scala version orchescala is built with, then the dependency"):
    assertEquals(
      ScalaCliDirectives("mycompany::mycompany-orchescala-helper:1.2.3").linesIterator.toSeq,
      Seq(
        s"//> using scala ${BuildInfo.scalaVersion}",
        "//> using dep mycompany::mycompany-orchescala-helper:1.2.3"
      )
    )

  test("both lines stay as they are in a script template with stripMargin"):
    val script =
      s"""#!/usr/bin/env -S scala shebang
         |
         |${ScalaCliDirectives("io.github.pme123::orchescala-helper:1.2.3")}
         |
         |import orchescala.helper.dev.DevCompanyHelper
         |""".stripMargin
    assert(script.contains(s"\n//> using scala ${BuildInfo.scalaVersion}\n"), script)
    assert(script.contains("\n//> using dep io.github.pme123::orchescala-helper:1.2.3\n"), script)

end ScalaCliDirectivesTest
