package orchescala.orchstudio

import zio.*
import zio.http.*
import zio.test.*

object SiteRoutesSpec extends ZIOSpecDefault:

  private def bytes(s: String) = s.getBytes("UTF-8")

  // the apps as from the jar - only listed files count
  private val apps = SiteSource.Memory(Map(
    "index.html"            -> bytes("orch-doc"),
    "assets/index-abc.js"   -> bytes("js"),
    "spec/index.html"       -> bytes("orch-spec"),
    "spec/assets/main-x.js" -> bytes("spec-js"),
    "ops/index.html"        -> bytes("orch-ops")
  ))

  // the folder lives as long as the test's effect - not just until the effect is built
  private def withData(f: os.Path => ZIO[Scope, Throwable, TestResult]): ZIO[Scope, Throwable, TestResult] =
    ZIO.acquireReleaseWith(ZIO.attempt(data()))(dir => ZIO.succeed(os.remove.all(dir)))(f)

  private def data(): os.Path =
    val dir = os.temp.dir(prefix = "site")
    os.write(dir / "index.json", """{"companies":[{"id":"democompany"}]}""")
    os.write(dir / "index.html", "old orch-doc of the company's site", createFolders = true)
    os.write(dir / "democompany" / "docs.json", "{}", createFolders = true)
    os.write(dir / "democompany" / "customer" / "OpenApi.yml", "openapi: 3.1.0", createFolders = true)
    os.write(dir / "democompany" / "2026-04" / "index.html", "classic", createFolders = true)
    os.write(dir / "spec" / "catalog.generated.json", "[]", createFolders = true)
    dir

  private def site(dir: os.Path, extras: Map[String, Array[Byte]] = Map.empty) =
    Site(Seq(SiteSource.Memory(extras), apps, SiteSource.Folder(dir)))

  private def get(routes: Routes[Any, Response], path: String) =
    routes.runZIO(Request.get(URL(Path.decode(path))))

  private def body(r: Response) = r.body.asString

  def spec = suite("SiteRoutes")(
    test("the apps under /site/, /site/spec/ and /site/ops/"):
      withData: dir =>
        val routes = SiteRoutes(site(dir)).routes
        for
          doc  <- get(routes, "/site/")
          spec <- get(routes, "/site/spec/")
          ops  <- get(routes, "/site/ops/")
          d    <- body(doc)
          s    <- body(spec)
          o    <- body(ops)
        yield assertTrue(d == "orch-doc", s == "orch-spec", o == "orch-ops") &&
          assertTrue(doc.headers.get("content-type").contains("text/html; charset=utf-8"))
    ,
    test("the app from the jar wins over the old copy in the company's site"):
      withData: dir =>
        ZIO.succeed(assertTrue(site(dir).resolve("/index.html") match
          case Site.Resolved.File(_, b) => String(b, "UTF-8") == "orch-doc"
          case _                        => false))
    ,
    test("the company's documentation from its folder"):
      withData: dir =>
        val routes = SiteRoutes(site(dir)).routes
        for
          idx     <- get(routes, "/site/index.json")
          api     <- get(routes, "/site/democompany/customer/OpenApi.yml")
          catalog <- get(routes, "/site/spec/catalog.generated.json")
          classic <- get(routes, "/site/democompany/2026-04/")
          c       <- body(classic)
        yield assertTrue(
          idx.status == Status.Ok,
          api.headers.get("content-type").contains("text/yaml; charset=utf-8"),
          catalog.status == Status.Ok,
          c == "classic"
        )
    ,
    test("redirects: folders get their slash, a company its page, short ways"):
      withData: dir =>
        val routes = SiteRoutes(site(dir)).routes
        def location(r: Response) = r.headers.get("location")
        for
          site    <- get(routes, "/site")
          spec    <- get(routes, "/site/spec")
          company <- get(routes, "/site/democompany")
          index   <- get(routes, "/site/democompany/index.html")
          root    <- get(routes, "/")
          short   <- get(routes, "/spec")
        yield assertTrue(
          location(site).contains("/site/"),
          location(spec).contains("/site/spec/"),
          location(company).contains("/site/#/democompany"),
          location(index).contains("/site/#/democompany"),
          location(root).contains("/site/"),
          location(short).contains("/site/spec/")
        )
    ,
    test("HEAD answers like GET, without the body"):
      withData: dir =>
        val routes = SiteRoutes(site(dir)).routes
        for
          there   <- routes.runZIO(Request.head(URL(Path.decode("/site/index.html"))))
          missing <- routes.runZIO(Request.head(URL(Path.decode("/site/missing.html"))))
          b       <- body(there)
        yield assertTrue(there.status == Status.Ok, b.isEmpty, missing.status == Status.NotFound)
    ,
    test("hashed assets are kept, the rest asked again"):
      assertTrue(
        SiteRoutes.cacheControl("spec/assets/main-x.js").contains("immutable"),
        SiteRoutes.cacheControl("spec/index.html") == "no-cache",
        SiteRoutes.cacheControl("democompany/docs.json") == "no-cache"
      )
    ,
    test("nothing outside the site, nothing that is not there"):
      withData: dir =>
        val s = site(dir)
        ZIO.succeed(assertTrue(
          s.resolve("/../secret.txt") == Site.Resolved.NotFound,
          s.resolve("/%2E%2E/secret.txt") == Site.Resolved.NotFound,
          s.resolve("/democompany%2F..%2F..%2Fsecret.txt") == Site.Resolved.NotFound,
          s.resolve("/missing.json") == Site.Resolved.NotFound,
          s.resolve("/democompany/customer") == Site.Resolved.NotFound
        ))
    ,
    test("the company folders of orch-spec and orch-ops"):
      withData: dir =>
        val folder = os.temp.dir(prefix = "spec")
        val hints  = SiteSource.folderHints(Seq("spec" -> folder, "ops" -> (folder / "missing")))
        val s      = Site(Seq(hints, apps, SiteSource.Folder(dir)))
        ZIO.succeed(assertTrue(
          s.resolve("/spec/folder.json") match
            case Site.Resolved.File(_, b) => String(b, "UTF-8") == s"""{"path":"$folder"}"""
            case _                        => false
          ,
          s.resolve("/ops/folder.json") == Site.Resolved.NotFound
        ))
    ,
    test("the apps of the orchescala-orch-doc jar are on the classpath"):
      val jar = SiteSource.orchDocApps()
      assertTrue(
        jar.isDefined,
        jar.exists(_.exists("index.html")),
        jar.exists(_.exists("spec/index.html")),
        jar.exists(_.exists("ops/index.html")),
        !jar.exists(_.exists("files.txt"))
      )
    ,
    test("the catalog of orch-spec is the company's - never one the jar brings"):
      assertTrue(
        SiteSource.isCompanyData("spec/catalog.generated.json"),
        SiteSource.isCompanyData("spec/folder.json"),
        !SiteSource.isCompanyData("spec/index.html"),
        !SiteSource.orchDocApps().exists(_.exists("spec/catalog.generated.json"))
      )
    ,
    test("a symbolic link out of the company's folder is not served"):
      withData: dir =>
        val outside = os.temp.dir(prefix = "outside")
        os.write(outside / "secret.txt", "secret")
        os.symlink(dir / "democompany" / "leak.txt", outside / "secret.txt")
        os.symlink(dir / "democompany" / "out", outside)
        os.symlink(dir / "democompany" / "inside.json", dir / "democompany" / "docs.json")
        val folder = SiteSource.Folder(dir)
        val leak   = folder.read("democompany/leak.txt")
        val out    = folder.read("democompany/out/secret.txt")
        // a link that stays inside is fine
        val inside = folder.read("democompany/inside.json").map(b => new String(b, "UTF-8"))
        ZIO.succeed(assertTrue(leak.isEmpty, out.isEmpty, inside.contains("{}")))
    ,
    test("the folder of orch-spec as JSON - also with a control character in its path"):
      val folder = os.temp.dir(prefix = "spec\nnew \"line\"")
      val hints  = SiteSource.folderHints(Seq("spec" -> folder))
      val json   = hints.read("spec/folder.json").map(String(_, "UTF-8"))
      assertTrue(
        json.flatMap(j => io.circe.parser.parse(j).toOption)
          .flatMap(_.hcursor.downField("path").as[String].toOption)
          .contains(folder.toString)
      )
    ,
    test("the company's site from a jar: files yes, directories no"):
      val jar = os.temp(suffix = ".jar")
      scala.util.Using.resource(java.util.jar.JarOutputStream(java.nio.file.Files.newOutputStream(jar.toNIO))): out =>
        out.putNextEntry(java.util.jar.JarEntry("site/democompany/"))
        out.closeEntry()
        out.putNextEntry(java.util.jar.JarEntry("site/democompany/docs.json"))
        out.write(bytes("{}"))
        out.closeEntry()
      val loader = java.net.URLClassLoader(Array(jar.toNIO.toUri.toURL), null)
      val site   = SiteSource.Classpath("site/", loader = loader)
      assertTrue(
        site.read("democompany/docs.json").map(String(_, "UTF-8")).contains("{}"),
        !site.exists("democompany"),
        site.read("democompany").isEmpty,
        !site.exists("missing.json")
      )
  )

end SiteRoutesSpec
