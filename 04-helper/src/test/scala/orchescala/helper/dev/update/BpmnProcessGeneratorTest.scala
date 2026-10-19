package orchescala.helper.dev.update

import munit.FunSuite
import orchescala.api.{ApiProjectConfig, ModelerTemplUpdater, ModuleType, VersionConfig}
import orchescala.domain.BpmnProcessType
import orchescala.helper.util.DevConfig

/** The template of `createProcess` and the grey of `api/run` (ModelerTemplUpdater) - the ids of its
  * init worker and mock elements must be the ones ModelerTemplUpdater greys.
  */
class BpmnProcessGeneratorTest extends FunSuite:

  private def template(processType: BpmnProcessType): String =
    val dir = os.temp.dir(prefix = "project-bpmn-")
    try
      os.dynamicPwd.withValue(dir):
        given DevConfig = DevConfig(
          ApiProjectConfig("democompany-customer", VersionConfig("0.1.0-SNAPSHOT"), Seq.empty, Seq.empty, Seq.empty, ModuleType.projectModules)
        )
        BpmnProcessGenerator(processType).createBpmn(SetupElement("Process", "bookAppointment", "BookAppointment", Some(1)))
        os.read(os.walk(dir / processType.diagramPath).filter(_.ext == "bpmn").head)
    finally os.remove.all(dir)

  // the shapes of the init worker and the mock elements in the template
  private def generatedShapes(xml: String): Set[String] =
    """bpmnElement="([^"]+)"""".r
      .findAllMatchIn(xml)
      .map(_.group(1))
      .filter(id => id == "InitProcessTask" || id.toLowerCase.contains("mocked"))
      .toSet

  // C7 (also Op) only - api/run colours the C7 diagrams (BpmnProcessType.diagramPaths), C8 is not supported yet
  test("the init worker and the mock elements of the template are greyed by api/run"):
    val shapes = generatedShapes(template(BpmnProcessType.C7()))
    assert(shapes.contains("InitProcessTask"), shapes.toString)
    assert(shapes.subsetOf(ModelerTemplUpdater.generatedIds), s"not in generatedIds: ${shapes -- ModelerTemplUpdater.generatedIds}")

end BpmnProcessGeneratorTest
