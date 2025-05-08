package orchescala.helper.util

import orchescala.api.{ApiProjectConfig, DependencyConfig, VersionHelper}

import scala.jdk.CollectionConverters.*

case class CompanyVersionHelper(
    companyName: String
):

  lazy val companyOrchescalaVersion: String =
    VersionHelper.repoSearch(s"$companyName-orchescala-domain_3", companyName)

end CompanyVersionHelper



