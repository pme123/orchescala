package orchescala.dmntester.client

import com.raquo.laminar.api.L.*
import orchescala.dmntester.{DmnConfig, DmnConfigGroup}

/** Step 2: which DMN tables shall be tested.
  *
  * A project can keep the DMNs of several platforms apart (`dmnConfigs/c7`,
  * `dmnConfigs/c8`) - each sub directory is its own group here.
  */
object ConfigsView:

  def apply(runTests: Observer[Unit]): HtmlElement =
    div(
      cls := "card",
      h2(cls := "section-title", "2 - DMN Tables to test"),
      child <-- AppState.configGroups.signal.map:
        case groups if groups.isEmpty =>
          div(cls := "note info", "There is no DmnConfig (*.conf) in this path.")
        case groups if groups.size == 1 && groups.head.path.isEmpty =>
          configTable(groups.head)
        case groups => div(groups.map(groupSection))
      ,
      div(
        cls := "row",
        marginTop := "0.75rem",
        button(
          cls := "btn primary",
          tpe := "button",
          Icons.play,
          "Run Tests",
          disabled <-- AppState.activeConfigs.map(_.isEmpty),
          onClick.mapToUnit --> runTests
        ),
        span(
          cls := "muted",
          child.text <-- AppState.activeConfigs.map: configs =>
            s"${configs.size} DMN table(s) selected"
        ),
        child.maybe <-- AppState.busy.signal.map: busy =>
          Option.when(busy)(
            span(
              cls := "row",
              span(cls := "busy"),
              span(cls := "muted", "evaluating …")
            )
          )
      )
    )

  private def groupSection(group: DmnConfigGroup): HtmlElement =
    div(
      h4(
        cls := "sub-title",
        group.name,
        span(
          cls := "muted",
          marginLeft := "0.5rem",
          s"${group.configs.size} table(s)"
        )
      ),
      configTable(group)
    )

  private def configTable(group: DmnConfigGroup): HtmlElement =
    div(
      cls := "tableScroll",
      table(
        thead(
          tr(
            th("Test"),
            th("Decision Id"),
            th("DMN Path"),
            th("Unit Test"),
            th("Missing Rules"),
            th("Inputs"),
            th("Test Cases"),
            th("Problem")
          )
        ),
        tbody(group.configs.map(configRow(group.path, _)))
      )
    )

  private def configRow(groupPath: String, dmnConfig: DmnConfig): HtmlElement =
    tr(
      td(
        input(
          tpe := "checkbox",
          checked := dmnConfig.isActive,
          onInput.mapToChecked --> (isActive =>
            AppState.toggleActive(groupPath, dmnConfig, isActive)
          )
        )
      ),
      td(dmnConfig.decisionId),
      td(
        cls := "muted",
        // one config can reference the DMN of several platforms
        dmnConfig.allDmnPaths.map: (source, path) =>
          div(
            source.map(s => span(cls := "badge", marginRight := "0.4rem", s)),
            span(path)
          )
      ),
      td(cls := "muted", if dmnConfig.testUnit then "yes" else "no"),
      td(cls := "muted", if dmnConfig.acceptMissingRules then "accepted" else "-"),
      td(
        dmnConfig.data.inputs
          .map(in => s"${in.key}: ${in.valuesAsString}")
          .mkString(" | ")
      ),
      td(cls := "index", dmnConfig.data.testCases.size.toString),
      td(
        cls := "failure",
        (dmnConfig.decisionIdError.toSeq ++ dmnConfig.dmnPathError.toSeq)
          .mkString(" ")
      )
    )
