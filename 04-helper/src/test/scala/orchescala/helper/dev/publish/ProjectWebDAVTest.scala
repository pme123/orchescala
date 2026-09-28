package orchescala.helper.dev.publish

import com.github.sardine.Sardine
import munit.FunSuite
import orchescala.api.ApiConfig
import orchescala.engine.DefaultEngineConfig
import orchescala.helper.util.PublishConfig

import java.lang.reflect.{InvocationHandler, Method, Proxy}
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

class ProjectWebDAVTest extends FunSuite:

  /** A WebDAV server that records the calls - `failOn` makes a call fail like the server would. */
  private def server(failOn: (String, String) => Boolean): (Sardine, ConcurrentLinkedQueue[String]) =
    val calls   = ConcurrentLinkedQueue[String]()
    val handler = new InvocationHandler:
      def invoke(proxy: Any, method: Method, args: Array[AnyRef]): AnyRef =
        val url = Option(args).flatMap(_.headOption).map(_.toString).getOrElse("")
        calls.add(s"${method.getName} $url")
        if failOn(method.getName, url) then throw java.io.IOException(s"${method.getName} failed")
        method.getName match
          case "list" => java.util.List.of() // nothing published yet
          case _      => null
    Proxy.newProxyInstance(getClass.getClassLoader, Array(classOf[Sardine]), handler).asInstanceOf[Sardine] -> calls

  private def webDAV(): ProjectWebDAV =
    val base = os.temp.dir()
    os.makeDir.all(base / "03-api")
    os.write(base / "03-api" / "OpenApi.yml", "openapi: 3.1.0")
    ProjectWebDAV(
      "my-project",
      ApiConfig(DefaultEngineConfig(), "mycompany", basePath = base),
      PublishConfig("https://docs.example.ch")
    )

  test("uploaded to a staging folder, then replaced by one MOVE - the published docs untouched before"):
    val (sardine, calls) = server((_, _) => false)
    webDAV().uploadWith(sardine)
    val sent = calls.asScala.toList
    assert(sent.exists(_.startsWith("put https://docs.example.ch/site/mycompany/_upload-my-project/")), sent)
    assert(!sent.exists(c => c.startsWith("put") && c.contains("/my-project/")), sent)
    assert(!sent.exists(c => c.startsWith("delete") && c.contains("/my-project/")), sent)
    assertEquals(sent.last, "move https://docs.example.ch/site/mycompany/_upload-my-project/")

  test("a failed upload leaves the published docs - they were deleted first"):
    val (sardine, calls) = server((method, url) => method == "put" && url.endsWith("OpenApi.yml"))
    intercept[java.io.IOException](webDAV().uploadWith(sardine))
    val touched = calls.asScala.toList.filter(_.contains("/mycompany/my-project/"))
    assertEquals(touched, Nil)

  test("a server without MOVE gets the docs the old way"):
    val (sardine, calls) = server((method, _) => method == "move")
    webDAV().uploadWith(sardine)
    val sent = calls.asScala.toList
    assert(sent.exists(_.startsWith("put https://docs.example.ch/site/mycompany/my-project/")), sent)

end ProjectWebDAVTest
