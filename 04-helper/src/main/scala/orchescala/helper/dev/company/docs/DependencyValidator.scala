package orchescala.helper.dev.company.docs

import orchescala.api.{ApiConfig, DocProjectConfig}

case class DependencyValidator()(using
    val apiConfig: ApiConfig,
    val configs: Seq[DocProjectConfig]
) extends DependencyCreator:

  // only a warning: the release page shows these dependencies in red (`2.30.*`)
  lazy val validateDependencies: Unit = {
    configs
      .filterNot(_.isWorker) // a worker takes the newest version of its dependencies
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
        println(
          s"""${Console.YELLOW_B}There are Package Config dependencies that are not in the VERSION.conf listed:
             |${failures.mkString("\n")}${Console.RESET}""".stripMargin
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
