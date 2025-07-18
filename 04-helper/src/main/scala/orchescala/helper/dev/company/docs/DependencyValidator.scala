package orchescala.helper.dev.company.docs

import orchescala.api.{ApiConfig, DocProjectConfig}

case class DependencyValidator()(using
    val apiConfig: ApiConfig,
    val configs: Seq[DocProjectConfig]
) extends DependencyCreator:

  @throws[IllegalStateException]
  lazy val validateDependencies: Unit = {
    configs
      .map { packageConf =>
        packageConf.fullName -> packageConf.dependencies
          .map { dConf =>
            dConf.fullName -> configs.exists(dConf.equalTo)
          }
          .filterNot { case _ -> v => v }
          .map(_._1)
      }
      .filterNot { case _ -> v => v.isEmpty }
      .map(f => s" - ${f._1} -> ${f._2.mkString("[", ", ", "]")}") match
      case Nil =>
        println(
          "All Packages have dependencies that are correctly configured in VERSION.conf."
        )
      case failures =>
        throw new IllegalStateException(
          s"There are Package Config dependencies that are not in the VERSION.conf listed:\n${failures
              .mkString("\n")}\n${configs.map(c => c.fullName).mkString("\n")}"
        )
  }

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
