package orchescala.dmntester.client

import com.raquo.laminar.api.L.*
import org.scalajs.dom

/** Light / dark theme - the class on `<html>` is what the CSS switches on
  * (`index.html` already sets it before the first paint).
  */
object Theme:

  private val storageKey = "orchescala.dmnTester.theme"

  val isDark: Var[Boolean] = Var(
    dom.document.documentElement.classList.contains("dark")
  )

  def toggle(): Unit =
    val dark = !isDark.now()
    isDark.set(dark)
    val classes = dom.document.documentElement.classList
    if dark then
      classes.add("dark")
      classes.remove("light")
    else
      classes.add("light")
      classes.remove("dark")
    dom.window.localStorage
      .setItem(storageKey, if dark then "dark" else "light")
