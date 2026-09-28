package orchescala.api

import java.util.regex.Pattern
import scala.util.matching.Regex

/** JIRA tickets in texts like the CHANGELOG - `ApiConfig.jiraUrls` maps a ticket prefix (`MAP`) to
  * the browse URL of its JIRA (`https://jira.example.com/browse`). Only configured prefixes count:
  * without `jiraUrls` a text has no tickets.
  */
object JiraLinks:

  /** Every ticket with a configured prefix becomes a Markdown link to its JIRA. A ticket that
    * appears twice is linked twice, but never inside a link; `MAP-1` never matches the start of
    * `MAP-12`; a ticket that already is a link (`[MAP-1](…/MAP-1)`) stays as it is.
    */
  def link(text: String, jiraUrls: Map[String, String]): String =
    ticketRegex(jiraUrls).fold(text): regex =>
      regex.replaceAllIn(
        text,
        m =>
          val ticket = m.matched
          val url    = jiraUrls(m.group(1)).stripSuffix("/")
          Regex.quoteReplacement(s"[$ticket]($url/$ticket)")
      )

  /** A changelog line with a ticket - `MAP-123: text` or `- MAP-123 text`: the ticket and the text
    * after it (with several tickets the last one).
    */
  def changelogTicket(line: String, jiraUrls: Map[String, String]): Option[(String, String)] =
    prefixes(jiraUrls).flatMap: p =>
      (s"""(.*)$notAfter($p-\\d+)$notBefore:? (.*)""").r
        .findFirstMatchIn(line)
        .map(m => m.group(2) -> m.group(4))

  // not part of a longer word, a link text `[…` or a URL `…/`
  private val notAfter  = """(?<![\w\[/-])"""
  private val notBefore = """(?![\w-])"""

  /** `(MAP|OTHER)` - the longest first, so that `MAP` does not win over `MAPX` */
  private def prefixes(jiraUrls: Map[String, String]): Option[String] =
    Option.when(jiraUrls.nonEmpty):
      jiraUrls.keys.toSeq.sortBy(-_.length).map(Pattern.quote).mkString("(", "|", ")")

  private def ticketRegex(jiraUrls: Map[String, String]): Option[Regex] =
    prefixes(jiraUrls).map(p => s"""$notAfter$p-\\d+$notBefore""".r)

end JiraLinks
