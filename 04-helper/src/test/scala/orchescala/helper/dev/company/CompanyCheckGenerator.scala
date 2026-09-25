package orchescala.helper.dev.company

import orchescala.engine.domain.EngineType
import orchescala.helper.util.DevConfig

/** Generates a company project (`democompany`) with the company generator - `sbt companyCheck`
  * then compiles it like a company build (see build.sbt). The generated code only exists as
  * strings in the generator, so this is the only place the compiler sees it.
  *
  * Args: output directory, supported engines (e.g. `target/company-check C7 C8`).
  */
object CompanyCheckGenerator:

  def main(args: Array[String]): Unit =
    val dir     = os.Path(args(0), os.pwd)
    val engines = args.drop(1).map(EngineType.valueOf).toSeq
    // the generator never overwrites existing files - start from scratch
    os.remove.all(dir)
    os.makeDir.all(dir)
    os.dynamicPwd.withValue(dir):
      given DevConfig = DevConfig.configForCompany("democompany-orchescala")
      CompanyWrapperGenerator().generate(engines)
    println(s"Company project generated for ${engines.mkString(", ")}: $dir")
  end main

end CompanyCheckGenerator
