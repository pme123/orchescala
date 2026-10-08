package orchescala.helper.dev.publish

/** The generated build files (`project/ProjectDef.scala`, `project/Settings.scala`) are read as
  * text - here they are read without their comments, so a commented-out setting is none.
  */
object ScalaSource:

  /** `scala` without its comments - the line comments (two slashes to the end of the line) and
    * the block comments (nested, as Scala has them); a comment marker inside a string or char
    * literal is no comment (an interpolation `$${...}` in a string is part of it); what an
    * unterminated block comment opens is dropped.
    */
  def withoutComments(scala: String): String =
    val out     = StringBuilder()
    var i       = 0
    var inStr   = false
    var inTri   = false // a triple-quoted string
    var inBlock = 0 // the depth - Scala nests block comments
    def at(j: Int): Char   = if j < scala.length then scala(j) else ' '
    def starts(t: String)  = scala.startsWith(t, i)
    while i < scala.length do
      val c = scala(i)
      if inBlock > 0 then
        if starts("*/") then
          inBlock -= 1
          i += 1
        else if starts("/*") then
          inBlock += 1
          i += 1
      else if inTri then
        out += c
        if starts("\"\"\"") && !starts("\"\"\"\"") then
          out ++= "\"\""
          i += 2
          inTri = false
      else if inStr then
        out += c
        if c == '\\' then
          out += at(i + 1)
          i += 1
        else if c == '$' && at(i + 1) == '{' then
          // an interpolation - copied up to its closing brace, whatever is in it; a string in
          // it (with braces of its own) is skipped as a string
          out += '{'
          i += 2
          var depth = 1
          while i < scala.length && depth > 0 do
            if scala(i) == '"' then
              out += '"'
              i += 1
              while i < scala.length && scala(i) != '"' do
                out += scala(i)
                if scala(i) == '\\' && i + 1 < scala.length then
                  out += scala(i + 1)
                  i += 1
                i += 1
              if i < scala.length then out += '"'
            else
              if scala(i) == '{' then depth += 1
              else if scala(i) == '}' then depth -= 1
              out += scala(i)
            i += 1
          i -= 1 // the loop below steps on
        else if c == '"' then inStr = false
      else if starts("\"\"\"") then
        inTri = true
        out ++= "\"\"\""
        i += 2
      else if c == '"' then
        inStr = true
        out += c
      else if c == '\'' && !(i > 0 && (scala(i - 1).isLetterOrDigit || scala(i - 1) == '_')) &&
          (at(i + 2) == '\'' || (at(i + 1) == '\\' && at(i + 3) == '\'') ||
            (at(i + 1) == '\\' && at(i + 2) == 'u' && at(i + 7) == '\''))
      then // (a prime of an identifier - `x'` - is none)
        // a char literal - `'"'`, `'/'`, `'\''`, `'\u0022'` are no string, no comment
        val len = if at(i + 1) == '\\' then (if at(i + 2) == 'u' then 8 else 4) else 3
        out ++= scala.substring(i, i + len)
        i += len - 1
      else if starts("//") then
        while i < scala.length && scala(i) != '\n' do i += 1
        i -= 1
      else if starts("/*") then
        inBlock = 1
        i += 1
      else out += c
      i += 1
    out.toString
  end withoutComments

end ScalaSource
