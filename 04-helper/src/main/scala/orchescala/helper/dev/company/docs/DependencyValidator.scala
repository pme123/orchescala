package orchescala.helper.dev.company.docs

import orchescala.api.{ApiConfig, DependencyConfig, DocProjectConfig}

case class DependencyValidator()(using
    val apiConfig: ApiConfig,
    val configs: Seq[DocProjectConfig]
) extends DependencyCreator:

  /** A dependency on a project that is not in VERSIONS.conf stops the docs; one on another minor
    * than VERSIONS.conf is only a warning - the release page shows it in red (`2.30.*`).
    */
  @throws[IllegalStateException]
  lazy val validateDependencies: Unit =
    val (missing, otherMinor) = DependencyValidator.dependencyFailures(configs)
    def lines(failures: Seq[(String, Seq[String])]) =
      failures.map((pkg, deps) => s" - $pkg -> ${deps.mkString("[", ", ", "]")}").mkString("\n")
    if otherMinor.nonEmpty then
      println(
        s"""${Console.YELLOW_B}There are Package Config dependencies on another minor than in VERSIONS.conf:
           |${lines(otherMinor)}${Console.RESET}""".stripMargin
      )
    if missing.nonEmpty then
      throw new IllegalStateException(
        s"There are Package Config dependencies that are not in the VERSION.conf listed:\n${lines(missing)}\n${configs.map(_.fullName).mkString("\n")}"
      )
    if missing.isEmpty && otherMinor.isEmpty then
      println("All Packages have dependencies that are correctly configured in VERSION.conf.")
  end validateDependencies

  // This harder to tell for sure, as the process can be used directly
  // So we issue only a Warning
  lazy val validateOrphans: Unit =
    val allDependencies = configs.flatMap(_.dependencies).distinct
    configs
      .filter(!_.isWorker)
      .groupBy(_.projectName)
      .map { case _ -> pcs =>
        if pcs.size > 1 then
          pcs
            .map(pc => pc.fullName -> allDependencies.count(_.equalTo(pc)))
            .filterNot(_._2 == 1)
            .map(_._1)
        else
          Seq.empty
      }
      .filterNot(_.isEmpty)
      .map(f => s" - ${f.mkString(", ")}")
      .toSeq match
      case Nil => println("All Packages are needed - no orphans.")
      case orphans =>
        println(s"""${Console.YELLOW_B}
                   |There are Versions of Packages that are not needed in VERSION.conf.
                   |For these the following Rules apply:
                   |- Packages that are not used by others may exist only once - only one active version.
                   |- Packages that are used by others may only exist if other packages still have them as a dependency.
                   |As they are difficult to separate, please check them:
                   |${orphans
                    .mkString("\n")}\n
                   |${Console.RESET}""".stripMargin)
    end match
  end validateOrphans

end DependencyValidator

object DependencyValidator:

  /** The dependencies per package that are not in the release: (on a project missing in
    * VERSIONS.conf, on another minor than there). A worker takes the newest version of its
    * dependencies - only a missing project counts for it.
    */
  def dependencyFailures(
      configs: Seq[DocProjectConfig]
  ): (Seq[(String, Seq[String])], Seq[(String, Seq[String])]) =
    def failures(isFailure: (DocProjectConfig, DependencyConfig) => Boolean) =
      configs
        .map(c => c.fullName -> c.dependencies.filter(isFailure(c, _)).map(_.fullName))
        .filter(_._2.nonEmpty)
    def inRelease(d: DependencyConfig) =
      configs.exists(c => c.companyName == d.companyName && c.projectName == d.projectName)
    (
      failures((_, d) => !inRelease(d)),
      failures((c, d) => !c.isWorker && inRelease(d) && !configs.exists(d.equalTo))
    )
  end dependencyFailures
end DependencyValidator
