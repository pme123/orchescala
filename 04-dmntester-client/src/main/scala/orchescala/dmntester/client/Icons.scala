package orchescala.dmntester.client

import com.raquo.laminar.api.L.svg as s
import com.raquo.laminar.api.L.SvgElement

/** The few lucide icons the UI needs - inlined, so the client stays dependency
  * free.
  */
object Icons:

  def sun: SvgElement = icon(
    s.circle(s.cx := "12", s.cy := "12", s.r := "4"),
    s.path(s.d := "M12 2v2"),
    s.path(s.d := "M12 20v2"),
    s.path(s.d := "m4.93 4.93 1.41 1.41"),
    s.path(s.d := "m17.66 17.66 1.41 1.41"),
    s.path(s.d := "M2 12h2"),
    s.path(s.d := "M20 12h2"),
    s.path(s.d := "m6.34 17.66-1.41 1.41"),
    s.path(s.d := "m19.07 4.93-1.41 1.41")
  )

  def moon: SvgElement = icon(
    s.path(s.d := "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")
  )

  def play: SvgElement = icon(
    s.path(s.d := "M6 3l14 9-14 9V3z")
  )

  def check: SvgElement = icon(
    s.path(s.d := "M20 6 9 17l-5-5")
  )

  def refresh: SvgElement = icon(
    s.path(s.d := "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"),
    s.path(s.d := "M21 3v5h-5"),
    s.path(s.d := "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"),
    s.path(s.d := "M8 16H3v5")
  )

  private def icon(children: SvgElement*): SvgElement =
    val svg = s.svg(
      s.width := "13",
      s.height := "13",
      s.viewBox := "0 0 24 24",
      s.fill := "none",
      s.stroke := "currentColor",
      s.strokeWidth := "2",
      s.strokeLineCap := "round",
      s.strokeLineJoin := "round"
    )
    children.foreach(child => svg.amend(child))
    svg
