package orchescala.dmntester

import orchescala.dmn.{DmnFlavor, DmnTesterDsl, InitialDmnCreator}

/** What a project extends: describe the DMNs with the DSL, then
  * `createDmnConfigs` starts the tester and writes the configurations.
  */
trait DmnTesterConfigCreator extends DmnTesterDsl, DmnConfigWriter, DmnTesterStarter:

  // both the DSL and the starter know the project root - it is the same one
  override protected def projectBasePath: os.Path = os.pwd

  // the path where the DMNs are
  protected def dmnBasePath: os.Path = testerConfig.dmnPaths.head
  // the path where the DMN Configs are
  protected def dmnConfigPath: os.Path = testerConfig.dmnConfigPaths.head
  // creating the Path to the DMN - by default the _dmnName_ is `decisionDmn.decisionDefinitionKey`.
  override protected def dmnPathOf(dmnName: String, source: Option[String]): os.Path =
    defaultDmnPath(dmnName, source)

  /** A DMN that is not there is no error here - `createDmnConfigs` reports it
    * (or creates it, see `.createC7Dmn`).
    */
  protected def defaultDmnPath(
      dmnName: String,
      source: Option[String] = None
  ): os.Path =
    testerConfig.dmnSource(source) /
      s"${dmnName.replace(s"${testerConfig.companyName}-", "")}.dmn"

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
    // `.createC7Dmn` / `.createC8Dmn` - so a decision that has no DMN yet is
    // found in the source below, like every other one
    dmnTesterObjects.foreach(createDmnIfMissing)
    startDmnTester
    val sources = testerConfig.sources
    val covered = scala.collection.mutable.Set.empty[os.Path]

    dmnTesterObjects.foreach: dmnTO =>
      val matching = sourcesOf(dmnTO, sources)
      covered ++= matching.map(_._2)
      if matching.isEmpty then
        val where = dmnTO.maybeDmnPath
          .map(path => s"'$path'")
          .getOrElse(
            s"'${dmnFileName(dmnTO)}' in any DMN source (${sources.map(_._2).mkString(", ")})"
          )
        println(
          s"WARNING: There is no DMN $where - " +
            s"'${dmnTO.dDmn.decisionDefinitionKey}' is not tested."
        )
      else if !dmnTO._inTestMode then
        // ONE configuration per decision, referencing every DMN it exists in -
        // so the same test cases run against all versions (c7 / c8).
        val paths = matching.map: (sourceName, dmnFile) =>
          sourceName -> dmnFile.relativeTo(projectBasePath).segments.toList
        dmnConfigs(Seq(dmnTO.withDmnPath(matching.head._2)))
          .map(_.withDmnPaths(paths))
          .foreach(updateConfig(_, dmnConfigPath))

    warnAboutUncoveredDmns(sources, covered.toSet)
    println(s"Check it on $testerUrl")
  end createDmnConfigs

  /** `.createC7Dmn` / `.createC8Dmn`: the DMN of the decision is created from
    * the domain object - the inputs, the outputs, their types and the hit
    * policy are all described there.
    *
    * An existing DMN is NEVER overwritten - only what is missing is created.
    */
  private def createDmnIfMissing(dmnTO: DmnTesterObject[?]): Unit =
    dmnTO._createDmn.foreach: flavor =>
      val dmnFile = dmnTO.maybeDmnPath
        .getOrElse(dmnSourceOf(dmnTO, flavor) / dmnFileName(dmnTO))
      if os.exists(dmnFile) then
        println(
          s"The DMN of '${dmnTO.dDmn.decisionDefinitionKey}' exists already - " +
            s"not created: $dmnFile"
        )
      else
        os.write.over(
          dmnFile,
          InitialDmnCreator.dmnXml(dmnTO.dDmn, flavor),
          createFolders = true
        )
        println(
          s"Created the ${flavor.sourceName.toUpperCase} DMN of " +
            s"'${dmnTO.dDmn.decisionDefinitionKey}' from its domain object: $dmnFile"
        )

  /** where a created DMN goes to - the source it was pinned to (`.from(...)`),
    * the source that is named like the flavor (`c7` / `c8`), or the only one.
    */
  private def dmnSourceOf(dmnTO: DmnTesterObject[?], flavor: DmnFlavor): os.Path =
    val source = dmnTO.source
      .orElse(Option.when(testerConfig.dmnSources.contains(flavor.sourceName))(flavor.sourceName))
    testerConfig.dmnSource(source)

  /** every source that has the DMN of this decision - or the one source the
    * decision was pinned to with `.from(...)` / `.dmnPath(...)`.
    */
  private def sourcesOf(
      dmnTO: DmnTesterObject[?],
      sources: Seq[(Option[String], os.Path)]
  ): Seq[(Option[String], os.Path)] =
    dmnTO.maybeDmnPath match
      case Some(path) =>
        // an explicit path wins - the source is the one it lies in
        Seq(sources.find((_, dir) => path.startsWith(dir)).map(_._1).flatten -> path)
          .filter((_, p) => os.exists(p))
      case None =>
        val fileName = dmnFileName(dmnTO)
        sources
          .filter((name, _) => dmnTO.source.forall(name.contains))
          .map((name, dir) => name -> (dir / fileName))
          .filter((_, file) => os.exists(file))

  private def dmnFileName(dmnTO: DmnTesterObject[?]): String =
    s"${dmnTO.dDmn.decisionDefinitionKey.replace(s"${testerConfig.companyName}-", "")}.dmn"

  /** a DMN nobody tests is worth knowing about */
  private def warnAboutUncoveredDmns(
      sources: Seq[(Option[String], os.Path)],
      covered: Set[os.Path]
  ): Unit =
    sources.foreach: (name, dir) =>
      if os.exists(dir) then
        val uncovered = os
          .list(dir)
          .filter(f => os.isFile(f) && f.ext == "dmn")
          .filterNot(covered.contains)
        if uncovered.nonEmpty then
          println(
            s"WARNING: ${uncovered.size} DMN(s) in ${name.map(n => s"'$n' ").getOrElse("")}$dir " +
              s"have no test configuration: ${uncovered.map(_.last).mkString(", ")}"
          )

end DmnTesterConfigCreator

