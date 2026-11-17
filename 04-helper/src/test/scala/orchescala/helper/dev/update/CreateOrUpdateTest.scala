package orchescala.helper.dev.update

class CreateOrUpdateTest extends munit.FunSuite:

  private def inTempDir(body: os.Path => Unit): Unit =
    val dir = os.temp.dir(prefix = "create-or-update-")
    try body(dir)
    finally os.remove.all(dir)

  test("the same content: the file is not written again"):
    inTempDir: dir =>
      val file    = dir / "build.properties"
      val content = s"// $doNotAdjust\nsbt.version=2.1.0\n"
      os.write(file, content)
      os.mtime.set(file, 1000000L) // a write would set the current time
      createOrUpdate(file, content)
      assertEquals(os.mtime(file), 1000000L)

  test("a hand-maintained file with the generated content: not written either"):
    inTempDir: dir =>
      val file    = dir / "build.sbt"
      val content = "// my own build - the same as generated\n"
      os.write(file, content)
      os.mtime.set(file, 1000000L)
      createOrUpdate(file, content)
      assertEquals(os.mtime(file), 1000000L)

  test("a new content of a generated file: replaced"):
    inTempDir: dir =>
      val file = dir / "build.properties"
      os.write(file, s"// $doNotAdjust\nsbt.version=1.13.1\n")
      createOrUpdate(file, s"// $doNotAdjust\nsbt.version=2.1.0\n")
      assert(os.read(file).contains("sbt.version=2.1.0"))

  test("a file without the marker: kept"):
    inTempDir: dir =>
      val file = dir / "build.sbt"
      os.write(file, "// my own build\n")
      createOrUpdate(file, s"// $doNotAdjust\n")
      assertEquals(os.read(file), "// my own build\n")

end CreateOrUpdateTest
