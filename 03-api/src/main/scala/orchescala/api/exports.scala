package orchescala.api

import os.CommandResult
import orchescala.domain.*

val catalogFileName = "catalog.md"
val defaultProjectConfigPath = os.rel / "PROJECT.conf"
lazy val projectsPath = os.pwd / "projects"

def shortenTag(refIdentShort: String) =
  val tag = shortenName(refIdentShort)
  tag.replace(".", " ").replace("-", " ").replace("_", " ").replace("  ", " ")
    .split(" ")
    .map: n =>
      s"${n.head.toUpper}${n.tail
        .map :
          case c: Char if c.isUpper => s" $c"
          case c => s"$c"
        .mkString}"
    .mkString(" ")
end shortenTag

enum InOutDocu:
  case IN, OUT, BOTH

enum ModuleType:
  case domain, engine, api, dmn, simulation, worker, helper, gateway
object ModuleType:
  def projectModules: Seq[ModuleType] = Seq(domain, api, dmn, simulation, worker, helper)
end ModuleType
extension (proc: os.proc)
  def callOnConsole(path: os.Path = os.pwd): CommandResult =
    proc.call(cwd = path, stdout = os.Inherit)
