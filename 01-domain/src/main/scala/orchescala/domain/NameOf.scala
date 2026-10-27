package orchescala.domain

import scala.quoted.{quotes, Expr, Quotes, Type}

object NameOf:

  def nameOfVariable(x: Expr[Any])(using Quotes): Expr[String] =
    val name = x.show.split("""\.""").last
      .replace(")", "") // attributes _.name -> returns name)
    println(s"Variable name: $name")
    Expr(name)
  end nameOfVariable

  /** The name of the val (or def) the expression is defined in - e.g. `Approved` for
    * `lazy val Approved = example.exists("x")`. Outside of one: [[nameOfVariable]].
    */
  def nameOfEnclosingVal(x: Expr[Any])(using Quotes): Expr[String] =
    import quotes.reflect.*
    def isNamed(sym: Symbol) =
      (sym.isValDef || sym.isDefDef) &&
        !sym.flags.is(Flags.Synthetic) && !sym.flags.is(Flags.Param) &&
        !sym.name.startsWith("$") && !sym.name.startsWith("<")
    def enclosing(sym: Symbol): Option[String] =
      if sym.isNoSymbol || sym.isClassDef || sym.isPackageDef then None
      else if isNamed(sym) then Some(sym.name)
      else enclosing(sym.owner)
    enclosing(Symbol.spliceOwner).map(Expr(_)).getOrElse(nameOfVariable(x))
  end nameOfEnclosingVal

  def nameOfType[A](using Type[A], Quotes): Expr[String] =
    Expr(Type.show[A])
end NameOf
