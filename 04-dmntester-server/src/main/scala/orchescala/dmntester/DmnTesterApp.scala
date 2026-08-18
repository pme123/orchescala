package orchescala.dmntester

import orchescala.dmntester.server.DmnTesterServer

/** The app a project runs to test its DMNs:
  *
  * {{{
  * // company level - orchescala-dmn of your company
  * trait CompanyDmnTester extends DmnTesterApp:
  *   override protected def starterConfig: DmnTesterStarterConfig =
  *     DmnTesterStarterConfig(
  *       companyName = "valiant",
  *       dmnConfigPaths = Seq(projectBasePath / "03-dmn" / "src" / "main" / "resources" / "dmnConfigs"),
  *       dmnPaths = Seq(projectBasePath / "src" / "main" / "resources" / "camunda")
  *     )
  *
  * // project level
  * object ProjectDmnTester extends CompanyDmnTester:
  *   override protected def dmnTesterObjects = Seq(
  *     DocumentInfoDmn.example.testUnit
  *       .testValues(_.docId, "Basisvertrag", "QR-Rechnung")
  *       .acceptMissingRules
  *   )
  * }}}
  *
  * The older style works as well - call `createDmnConfigs` in the body:
  *
  * {{{
  * object ProjectDmnTester extends CompanyDmnTester:
  *   createDmnConfigs(
  *     DocumentInfoDmn.example.testUnit
  *       .testValues(_.docId, "Basisvertrag", "QR-Rechnung")
  *       .acceptMissingRules,
  *     StaticDocumentsDmn.example.testUnit
  *       .testValues(_.docId, "Basisvertrag")
  *       .inTestMode
  *   )
  * }}}
  *
  * `dmn/runMain valiant.documents.dmn.ProjectDmnTester` then writes the
  * configurations, starts the tester in this JVM and keeps it running until
  * you stop it - there is no Docker involved.
  */
trait DmnTesterApp extends DmnTesterConfigCreator:

  /** The DMN tables to test - described with the DSL.
    *
    * You may also call `createDmnConfigs(...)` directly in the body of your
    * object; then this stays empty.
    */
  protected def dmnTesterObjects: Seq[DmnTesterObject[?]] = Seq.empty

  /** keep the tester running after the configurations were written, so you can
    * work with it in the browser. Set to false to only generate the configs.
    */
  protected def keepRunning: Boolean = true

  final def main(args: Array[String]): Unit =
    // `createDmnConfigs(...)` in the body of the object has already run at
    // this point (it initialises the object) - so only create what is left.
    if dmnTesterObjects.nonEmpty then createDmnConfigs(dmnTesterObjects*)
    else startDmnTester
    if keepRunning && DmnTesterServer.isRunning then
      println(s"Press Ctrl-C to stop the DMN Tester ($testerUrl)")
      DmnTesterServer.awaitShutdown()
end DmnTesterApp
