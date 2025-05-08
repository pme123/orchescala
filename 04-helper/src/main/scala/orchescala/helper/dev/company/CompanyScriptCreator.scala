package orchescala.helper.dev.company

import orchescala.api.VersionHelper
import orchescala.helper.util.DevConfig

case class CompanyScriptCreator()(using config: DevConfig):

  lazy val companyHelper =
    s"""#!/usr/bin/env -S scala shebang
       |$helperCompanyDoNotAdjustText
       |
       |//> using toolkit 0.5.0
       |//> using dep io.github.pme123::orchescala-helper:${VersionHelper.orchescalaVersion}
       |
       |import orchescala.helper.dev.DevCompanyHelper
       |
       |   @main
       |   def run(command: String, arguments: String*): Unit =
       |     DevCompanyHelper.run(command, arguments*)
       |""".stripMargin

  lazy val companyOrchescalaHelper =
    s"""#!/usr/bin/env -S scala shebang
       |$helperCompanyDoNotAdjustText
       |
       |//> using dep ${config.companyName}::${config.companyName}-orchescala-helper:${config.versionConfig.companyOrchescalaVersion}
       |
       |import ${config.companyName}.orchescala.helper.*
       |
       |@main
       |def run(command: String, args: String*): Unit =
       |  CompanyOrchescalaDevHelper.runForCompany(command, args*)
       |""".stripMargin

end CompanyScriptCreator
