package orchescala.helper.dev.update

import orchescala.helper.util.CompanyVersionHelper

case class ScriptCreator()(using config: DevConfig):


  lazy val projectHelper =
    s"""$helperHeader
       |
       |@main
       |def run(command: String, arguments: String*): Unit =
       |  CompanyDevHelper.run(command, arguments*)
       |""".stripMargin
  end projectHelper
  
  lazy val projectHelperForGateway =
    s"""$helperHeader
       |
       |@main
       |def run(command: String, arguments: String*): Unit =
       |  CompanyDevHelper.runForGateway(command, arguments*)
       |""".stripMargin
  end projectHelperForGateway

  private lazy val companyName = config.companyName
  private lazy val versionHelper = CompanyVersionHelper(companyName)
  private lazy val helperHeader =
    s"""#!/usr/bin/env -S scala shebang
       |$helperDoNotAdjustText
       |
       |//> using dep $companyName::$companyName-orchescala-helper:${versionHelper.companyOrchescalaVersion}
       |
       |import $companyName.orchescala.helper.*
       |""".stripMargin

end ScriptCreator
