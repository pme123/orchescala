package orchescala.dmntester.server.runner

import zio.{Console, UIO}

/** Resolves a config-/ DMN path. Relative paths are resolved against the
  * working directory (that is where a project starts the tester), absolute
  * paths are taken as they are.
  */
def osPath(path: String): os.Path = osPath(List(path))

def osPath(path: List[String]): os.Path =
  val segments = path
    .map(_.trim)
    .filter(_.nonEmpty)
    .flatMap(_.split("/").toList)
    .filter(_.nonEmpty)
  val isAbsolute = path.headOption.exists(_.trim.startsWith("/"))
  segments.foldLeft(if isAbsolute then os.root else os.pwd):
    case (p, "..") => p / os.up
    case (p, ".")  => p
    case (p, seg)  => p / seg

def printLine(msg: String): UIO[Unit] =
  Console.printLine(msg).orDie

def printWarning(msg: String): UIO[Unit] =
  printLine(scala.Console.YELLOW + msg + scala.Console.RESET)

def printError(msg: String): UIO[Unit] =
  printLine(scala.Console.RED + msg + scala.Console.RESET)
