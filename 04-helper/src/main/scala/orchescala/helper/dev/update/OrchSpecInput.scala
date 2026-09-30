package orchescala.helper.dev.update

import scala.annotation.tailrec
import scala.io.StdIn
import scala.util.Try

/** Reads the exports of Orch Spec in the terminal - first the BPMN, then the Scala classes.
  *
  * Each one either from the clipboard (`Kopieren` in the export dialog, then Enter) or pasted into
  * the terminal. The clipboard is the safer way: a terminal may cut long lines of a paste.
  */
object OrchSpecInput:

  val commandPrefix = "orchspec:"

  /** The argument of «Process from Spec» in Orch Spec: `orchspec:` + base64url(gzip(JSON)) with
    * `{ v: 1, bpmn?: String, scala: String }` - returns the BPMN (if the spec has a diagram) and the
    * Scala classes.
    */
  def fromCommand(argument: String): (Option[String], String) =
    val json = Try:
      val zipped = java.util.Base64.getUrlDecoder.decode(argument.stripPrefix(commandPrefix).trim)
      val in     = java.util.zip.GZIPInputStream(java.io.ByteArrayInputStream(zipped))
      try String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)
      finally in.close()
    .getOrElse:
      throw IllegalArgumentException(
        "The argument is not readable - copy it again in Orch Spec (Export > Process from Spec)."
      )
    val cursor = io.circe.parser.parse(json).fold(e => throw IllegalArgumentException(e.getMessage), _.hcursor)
    cursor.get[Int]("v") match
      case Right(1) =>
        (
          cursor.get[Option[String]]("bpmn").toOption.flatten,
          cursor.get[String]("scala").getOrElse("")
        )
      case other    =>
        throw IllegalArgumentException(
          s"Version ${other.getOrElse("?")} of the Orch Spec export is not known - update the orchescala helper."
        )
    end match
  end fromCommand

  def bpmn(): String =
    read(
      "1/2",
      "BPMN",
      "BPMN",
      "",
      isEnd = l => l.contains("</") && l.trim.endsWith("definitions>"),
      describe = xml =>
        OrchSpecExport.processId(xml).map: id =>
          s"$id (${if OrchSpecExport.isC8(xml) then "Camunda 8" else "Camunda 7"})"
    )

  def scalaClasses(): String =
    read(
      "2/2",
      "Scala classes",
      "Scala",
      " - finish with a line END",
      isEnd = _.trim == "END",
      describe = text =>
        val files = OrchSpecExport.parse(text)
        if files.nonEmpty then Some(s"${files.size} files")
        // Orch Spec exports only this comment if there is no data model
        else Option.when(text.contains("Datenmodell"))("no classes")
    )

  /** Asks until it gets a valid text - `describe` tells what it got, `None` if it is not valid. */
  private def read(
      step: String,
      what: String,
      exportKind: String,
      pasteEnd: String,
      isEnd: String => Boolean,
      describe: String => Option[String]
  ): String =
    println(s"$step $what - in Orch Spec: Export > $exportKind > Kopieren, then press Enter here (or paste it here$pasteEnd):")

    @tailrec
    def loop(): String =
      val text = Option(StdIn.readLine()) match
        case None                         =>
          throw IllegalStateException(s"No input for the $what.")
        case Some(first) if first.isBlank =>
          clipboard().getOrElse:
            println(s"${Console.RED}  The clipboard is not readable - paste it here.${Console.RESET}")
            ""
        case Some(first)                  =>
          pasted(first, isEnd)
      describe(text) match
        case Some(description) =>
          println(s"${Console.GREEN}  ✓ $description${Console.RESET}")
          text
        case None              =>
          println(
            s"${Console.RED}  ✗ These are not the $what of Orch Spec - copy them and press Enter (Ctrl-C to cancel).${Console.RESET}"
          )
          loop()
      end match
    end loop

    loop()
  end read

  private def pasted(first: String, isEnd: String => Boolean): String =
    @tailrec
    def loop(lines: Vector[String]): Vector[String] =
      if isEnd(lines.last) then lines
      else
        Option(StdIn.readLine()) match
          case Some(line) => loop(lines :+ line)
          case None       => lines // Ctrl-D
    val lines = loop(Vector(first))
    dropBlankLines()
    lines.filterNot(_.trim == "END").mkString("\n") + "\n"
  end pasted

  // the last newlines of a paste must not answer the next question with Enter (= clipboard)
  @tailrec
  private def dropBlankLines(): Unit =
    val in = Console.in
    if Try(in.ready()).getOrElse(false) then
      in.mark(1 << 20)
      val line = in.readLine()
      if line != null && line.isBlank then dropBlankLines()
      else in.reset()
  end dropBlankLines

  private def clipboard(): Option[String] =
    val osName   = sys.props("os.name").toLowerCase
    val commands =
      if osName.contains("mac") then Seq(Seq("pbpaste"))
      else if osName.contains("win") then
        Seq(Seq(
          "powershell",
          "-NoProfile",
          "-Command",
          "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"
        ))
      else Seq(Seq("wl-paste", "--no-newline"), Seq("xclip", "-selection", "clipboard", "-o"))
    commands.view
      .flatMap: command =>
        // UTF-8, else pbpaste breaks the umlauts and the box characters of the Scala export
        Try(os.proc(command).call(env = Map("LANG" -> "en_US.UTF-8"), stderr = os.Pipe).out.text()).toOption
      .find(_.trim.nonEmpty)
  end clipboard

end OrchSpecInput
