package orchescala.dmntester.server

import munit.FunSuite
import orchescala.dmntester.*
import zio.{Runtime, Unsafe}

/** Configurations may be organised in sub directories - the tester shows one
  * group per directory.
  */
class ConfigGroupsTest extends FunSuite:

  private val target = os.pwd / "04-dmntester-server" / "target" / "config-groups"

  private def write(dir: Option[String], decisionId: String): Unit =
    val config = DmnConfig(
      decisionId = decisionId,
      dmnPath = List("some", "where", s"$decisionId.dmn")
    )
    os.write.over(
      dir.map(target / _).getOrElse(target) / s"$decisionId.conf",
      runner.hocon.render(config),
      createFolders = true
    )

  test("the configs of every sub directory are served as their own group"):
    os.remove.all(target)
    write(Some("c7"), "old-decision")
    write(Some("c8"), "new-decision")
    write(None, "root-decision")
    val service = new ZDmnService(
      DmnTesterServerConfig(configPaths = Seq(target.relativeTo(os.pwd).toString))
    )
    val groups = Unsafe.unsafe { implicit u =>
      Runtime.default.unsafe
        .run(service.loadConfigs(Seq(target.relativeTo(os.pwd).toString)))
        .getOrThrowFiberFailure()
    }
    assertEquals(groups.map(_.path), Seq("", "c7", "c8"))
    assertEquals(groups.map(_.name), Seq("/", "c7", "c8"))
    assertEquals(
      groups.map(_.configs.map(_.decisionId)),
      Seq(Seq("root-decision"), Seq("old-decision"), Seq("new-decision"))
    )

end ConfigGroupsTest
