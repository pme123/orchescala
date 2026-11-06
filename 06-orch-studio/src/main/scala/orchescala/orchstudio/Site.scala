package orchescala.orchstudio

import java.net.{URLDecoder, URLEncoder}
import java.nio.charset.StandardCharsets.UTF_8

/** The documentation site under `/site/` - the same layout as the gateway of Orchescala serves:
  *
  *   - `index.html`, `assets/`   orch-doc, the documentation app
  *   - `spec/`, `ops/`           orch-spec and orch-ops
  *   - `index.json`, `<company>/…`, `spec/catalog.generated.json`   the company's documentation
  *
  * A file is taken from the first source that has it - see [[Site.apply]] for the order.
  */
final case class Site(sources: Seq[SiteSource]):
  import Site.Resolved

  /** What a request for `/site/<path>` gets. `path` is the raw (URL encoded) rest after `/site`. */
  def resolve(path: String): Resolved =
    val trailingSlash = path.isEmpty || path.endsWith("/")
    Site.segments(path) match
      case None           => Resolved.NotFound
      case Some(segments) =>
        val looksLikeFile = segments.lastOption.exists(_.contains('.'))
        segments match
          case Seq() =>
            if path.isEmpty then Resolved.Redirect("/site/") else file("index.html")
          // `/site/<company>` -> its page in the documentation app (one page for all companies;
          // the company folder only holds its data and the classic sites of older releases)
          case Seq(company) if !looksLikeFile && exists(s"$company/docs.json")             =>
            Resolved.Redirect(s"/site/#/${Site.encode(company)}")
          case Seq(company, "index.html") if exists(s"$company/docs.json")                  =>
            Resolved.Redirect(s"/site/#/${Site.encode(company)}")
          case _ if trailingSlash                                                           =>
            file(s"${segments.mkString("/")}/index.html")
          // a folder without the slash (`/site/spec`) - relative links need it
          case _ if !looksLikeFile                                                          =>
            val dir = segments.mkString("/")
            if exists(s"$dir/index.html") then Resolved.Redirect(s"/site/${segments.map(Site.encode).mkString("/")}/")
            else Resolved.NotFound
          case _                                                                            =>
            file(segments.mkString("/"))
  end resolve

  private def exists(rel: String): Boolean = sources.exists(_.exists(rel))

  private def file(rel: String): Resolved =
    sources.iterator.flatMap(_.read(rel)).nextOption() match
      case Some(bytes) => Resolved.File(rel, bytes)
      case None        => Resolved.NotFound

end Site

object Site:

  enum Resolved:
    case File(rel: String, bytes: Array[Byte])
    case Redirect(location: String)
    case NotFound

  /** The site of the studio. The order decides who wins:
    *   1. `extras` - files in memory, e.g. the company folders of orch-spec and orch-ops
    *   2. the apps from the orchescala-orch-doc jar - the version the studio is built with, also when
    *      the company's site still has an older copy
    *   3. the company's documentation - `data`
    */
  def apply(data: SiteSource, extras: SiteSource = SiteSource.Memory(Map.empty)): Site =
    Site(Seq(extras) ++ SiteSource.orchDocApps().toSeq :+ data)

  /** The decoded segments - None if one could leave the site (`..`) or is not a plain name. */
  private[orchstudio] def segments(path: String): Option[Seq[String]] =
    val decoded = path.split('/').toSeq.filter(_.nonEmpty)
      .map(s => scala.util.Try(URLDecoder.decode(s.replace("+", "%2B"), UTF_8)).toOption)
    Option.when(decoded.forall(_.exists(isPlainName)))(decoded.flatten)

  private def isPlainName(s: String): Boolean =
    s.nonEmpty && s != "." && s != ".." && !s.exists(c => c == '/' || c == '\\' || c.isControl)

  private def encode(segment: String): String =
    URLEncoder.encode(segment, UTF_8).replace("+", "%20")

end Site
