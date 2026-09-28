package orchescala.helper.dev.publish

import munit.FunSuite

class ChangeLogUpdaterTest extends FunSuite:

  import ChangeLogUpdater.repositoryWebAddress

  test("credentials of an https remote do not go into the CHANGELOG"):
    assertEquals(
      repositoryWebAddress("https://pme:glpat-secret@gitlab.company.ch/group/repo.git"),
      "https://gitlab.company.ch/group/repo.git"
    )
    assertEquals(
      repositoryWebAddress("https://oauth2:token@gitlab.company.ch:8443/group/repo.git"),
      "https://gitlab.company.ch:8443/group/repo.git"
    )

  test("an https remote without credentials stays as it is"):
    assertEquals(
      repositoryWebAddress("https://github.com/pme123/orchescala.git"),
      "https://github.com/pme123/orchescala.git"
    )

  test("an ssh remote becomes its https address - without user and ssh port"):
    assertEquals(
      repositoryWebAddress("ssh://git@gitlab.company.ch:2222/group/repo.git"),
      "https://gitlab.company.ch/group/repo.git"
    )
    assertEquals(
      repositoryWebAddress("git@github.com:pme123/orchescala.git"),
      "https://github.com/pme123/orchescala.git"
    )

  test("the commit links of the CHANGELOG"):
    val commitsAddress = repositoryWebAddress("git@github.com:pme123/orchescala.git")
      .replace(".git", "/commit/")
    assertEquals(commitsAddress, "https://github.com/pme123/orchescala/commit/")

end ChangeLogUpdaterTest
