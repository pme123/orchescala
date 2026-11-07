package orchescala.worker

import munit.FunSuite
import orchescala.engine.domain.DeploymentEntry

class DeployOnStartTest extends FunSuite:

  test("entryOf: company and project from the application name, version from the jar"):
    assertEquals(
      DeployOnStart.entryOf("mycompany-myproject", Some("1.2.0")),
      Some(DeploymentEntry("mycompany", "mycompany-myproject", "1.2.0"))
    )

  test("entryOf: without a version (not from a jar) nothing to deploy"):
    assertEquals(DeployOnStart.entryOf("mycompany-myproject", None), None)
    assertEquals(DeployOnStart.entryOf("mycompany-myproject", Some("")), None)

  test("manifestJson: the body of POST /deployment"):
    assertEquals(
      DeployOnStart.manifestJson(DeploymentEntry("mycompany", "mycompany-myproject", "1.2.0")).noSpaces,
      """{"deployments":[{"company":"mycompany","project":"mycompany-myproject","version":"1.2.0"}]}"""
    )

  test("deployedKeys: the keys of the deployed processes and decisions"):
    val body =
      """[{"deploymentId":"1","deployedProcesses":[{"id":"p:1","key":"my-process","version":1}],
        |"deployedDecisions":[{"id":"d:1","key":"my-decision","version":2}]},
        |{"deploymentId":"2","deployedProcesses":[{"id":"p:2","key":"my-process","version":2}],"deployedDecisions":[]}]""".stripMargin
    assertEquals(DeployOnStart.deployedKeys(body), "my-decision, my-process")

  test("deployedKeys: an unexpected body as it is"):
    assertEquals(DeployOnStart.deployedKeys("not json"), "not json")
    assertEquals(DeployOnStart.deployedKeys("[]"), "[]")

end DeployOnStartTest
