package orchescala.helper.util

import orchescala.BuildInfo

/** The `//> using` lines of the generated scala-cli scripts (`helperCompany.scala`,
  * `helper.scala`) - one place for all of them.
  *
  * The Scala version is pinned to the one orchescala is built with: without it scala-cli takes its
  * own default version, which cannot read a helper built with a newer Scala.
  */
object ScalaCliDirectives:

  def apply(dependency: String): String =
    s"""//> using scala ${BuildInfo.scalaVersion}
       |//> using dep $dependency""".stripMargin

end ScalaCliDirectives
