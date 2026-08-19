package orchescala.dmntester

import orchescala.dmn.DmnTesterDsl

import java.io.FileNotFoundException

/** What a project extends: describe the DMNs with the DSL, then
  * `createDmnConfigs` starts the tester and writes the configurations.
  */
trait DmnTesterConfigCreator extends DmnTesterDsl, DmnConfigWriter, DmnTesterStarter:

  // both the DSL and the starter know the project root - it is the same one
  override protected def projectBasePath: os.Path = os.pwd

  // the path where the DMN Configs are
  protected def dmnConfigPath: os.Path = testerConfig.dmnConfigPaths.head
  // creating the Path to the DMN - by default the _dmnName_ is `decisionDmn.decisionDefinitionKey`.
  override protected def dmnPathOf(dmnName: String, source: Option[String]): os.Path =
    defaultDmnPath(dmnName, source)

  protected def defaultDmnPath(
      dmnName: String,
      source: Option[String] = None
  ): os.Path =
    val dmnPath = testerConfig.dmnSource(source) /
      s"${dmnName.replace(s"${testerConfig.companyName}-", "")}.dmn"
    if (!dmnPath.toIO.exists())
      throw FileNotFoundException(s"There is no DMN in $dmnPath")
    dmnPath

  /** Writes a configuration for every DMN source that HAS this decision.
    *
    * You describe a decision once; the tester looks it up in every source of
    * your project (e.g. `c7` and `c8`) and creates a configuration per source
    * it finds it in. That way one description covers all versions of a DMN -
    * which is what you want while migrating.
    *
    * What is missing is reported instead of guessed:
    *   - a decision whose DMN is in no source at all,
    *   - a DMN in a source that no decision covers.
    */
  protected def createDmnConfigs(dmnTesterObjects: DmnTesterObject[?]*): Unit =
    startDmnTester
    val sources = testerConfig.sources
    val covered = scala.collection.mutable.Set.empty[os.Path]

    dmnTesterObjects.foreach: dmnTO =>
      val matching = sourcesOf(dmnTO, sources)
      covered ++= matching.map(_.path)
      if matching.isEmpty then
        println(
          s"WARNING: There is no DMN '${dmnFileName(dmnTO)}' in any DMN source " +
            s"(${sources.map(_.path).mkString(", ")}) - '${dmnTO.dDmn.decisionDefinitionKey}' is not tested."
        )
      else if !dmnTO._inTestMode then
        // ONE configuration per decision, referencing every DMN it exists in -
        // so the same test cases run against all versions (c7 / c8).
        val paths = matching.map: source =>
          source.name -> source.path.relativeTo(projectBasePath).toString
        dmnConfigs(Seq(dmnTO.withDmnPath(matching.head.path)))
          .map(_.withDmnPaths(paths))
          .foreach(updateConfig(_, dmnConfigPath))

    warnAboutUncoveredDmns(sources, covered.toSet)
    println(s"Check it on $testerUrl")
  end createDmnConfigs

  /** every source that has the DMN of this decision - or the one source the
    * decision was pinned to with `.from(...)` / `.dmnPath(...)`.
    */
  private def sourcesOf(
      dmnTO: DmnTesterObject[?],
      sources: Seq[DmnSource]
  ): Seq[DmnSource] =
    dmnTO.maybeDmnPath match
      case Some(path) =>
        // an explicit path wins - the source is the one it lies in
        Seq(DmnSource(sources.find(s => path.startsWith(s.path)).flatMap(_.name), path))
          .filter(s => os.exists(s.path))
      case None =>
        val fileName = dmnFileName(dmnTO)
        sources
          .filter(s => dmnTO.source.forall(s.name.contains))
          .map(s => s.copy(path = s.path / fileName))
          .filter(s => os.exists(s.path))

  private def dmnFileName(dmnTO: DmnTesterObject[?]): String =
    s"${dmnTO.dDmn.decisionDefinitionKey.replace(s"${testerConfig.companyName}-", "")}.dmn"

  /** a DMN nobody tests is worth knowing about */
  private def warnAboutUncoveredDmns(
      sources: Seq[DmnSource],
      covered: Set[os.Path]
  ): Unit =
    sources.foreach: source =>
      val dir = source.path
      if os.exists(dir) then
        val uncovered = os
          .list(dir)
          .filter(f => os.isFile(f) && f.ext == "dmn")
          .filterNot(covered.contains)
        if uncovered.nonEmpty then
          println(
            s"WARNING: ${uncovered.size} DMN(s) in ${source.name.map(n => s"'$n' ").getOrElse("")}$dir " +
              s"have no test configuration: ${uncovered.map(_.last).mkString(", ")}"
          )

end DmnTesterConfigCreator

