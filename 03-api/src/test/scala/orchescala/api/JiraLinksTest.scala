package orchescala.api

class JiraLinksTest extends munit.FunSuite:

  private val jiraUrls = Map(
    "MAP"   -> "https://jira.example.com/browse",
    "OTHER" -> "https://other.example.com/browse/"
  )

  test("a ticket with a configured prefix becomes a link"):
    assertEquals(
      JiraLinks.link("MAP-123: My ticket.", jiraUrls),
      "[MAP-123](https://jira.example.com/browse/MAP-123): My ticket."
    )

  test("each prefix links to its own JIRA - a trailing slash in the URL does not double"):
    assertEquals(
      JiraLinks.link("MAP-1 and OTHER-2", jiraUrls),
      "[MAP-1](https://jira.example.com/browse/MAP-1) and [OTHER-2](https://other.example.com/browse/OTHER-2)"
    )

  test("the same ticket twice is linked twice - never a link inside a link"):
    assertEquals(
      JiraLinks.link("MAP-1, again MAP-1", jiraUrls),
      "[MAP-1](https://jira.example.com/browse/MAP-1), again [MAP-1](https://jira.example.com/browse/MAP-1)"
    )

  test("MAP-1 does not match the start of MAP-12"):
    assertEquals(
      JiraLinks.link("MAP-1 and MAP-12", jiraUrls),
      "[MAP-1](https://jira.example.com/browse/MAP-1) and [MAP-12](https://jira.example.com/browse/MAP-12)"
    )

  test("an existing link, unknown prefixes and look-alikes stay as they are"):
    val text = "[MAP-1](https://jira.example.com/browse/MAP-1), ABC-7, XMAP-3, MAP-4x, UTF-8"
    assertEquals(JiraLinks.link(text, jiraUrls), text)

  test("without jiraUrls a text has no tickets"):
    assertEquals(JiraLinks.link("MAP-123: My ticket.", Map.empty), "MAP-123: My ticket.")
    assertEquals(JiraLinks.changelogTicket("- MAP-123: My ticket.", Map.empty), None)

  test("changelog line: the ticket and the text after it"):
    assertEquals(JiraLinks.changelogTicket("- MAP-123: My ticket.", jiraUrls), Some("MAP-123" -> "My ticket."))
    assertEquals(JiraLinks.changelogTicket("- OTHER-9 fixed it", jiraUrls), Some("OTHER-9" -> "fixed it"))

  test("changelog line without a configured ticket"):
    assertEquals(JiraLinks.changelogTicket("- Updated dependencies.", jiraUrls), None)
    assertEquals(JiraLinks.changelogTicket("- ABC-123: not ours.", jiraUrls), None)
    assertEquals(JiraLinks.changelogTicket("- Encoding UTF-8 fixed.", jiraUrls), None)

end JiraLinksTest
