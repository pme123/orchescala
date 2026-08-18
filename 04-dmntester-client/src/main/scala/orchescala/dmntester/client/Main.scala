package orchescala.dmntester.client

import com.raquo.laminar.api.L.*
import org.scalajs.dom

/** The DMN Table Tester UI:
  *   1. select the path with your `*.conf` test definitions
  *   2. check the DMN tables you want to test
  *   3. check the results - and accept what is correct
  */
object Main:

  private val runTestsBus = new EventBus[Unit]

  def main(args: Array[String]): Unit =
    renderOnDomContentLoaded(dom.document.getElementById("dmnTester"), app)

  private lazy val app: HtmlElement =
    div(
      BackendClient.getBasePath --> (r => AppState.show(r, AppState.basePath.set)),
      BackendClient.getEngineName --> (r =>
        AppState.show(r, AppState.engineName.set)
      ),
      BackendClient.getConfigPaths --> (r =>
        AppState.show(
          r,
          paths =>
            AppState.configPaths.set(paths)
            paths.headOption.foreach(AppState.selectedPath.set)
        )
      ),
      AppState.selectedPath.signal.flatMapSwitch(path =>
        if path.isEmpty then EventStream.empty else BackendClient.getConfigs(path)
      ) --> (r =>
        AppState.results.set(None)
        AppState.show(r, AppState.configGroups.set)
      ),
      runTestsBus.events
        .sample(AppState.activeConfigs)
        .flatMapSwitch { active =>
          AppState.busy.set(true)
          AppState.saved.set(None)
          // ONE configuration can reference several DMNs (c7/c8) and then
          // produces several results - so the sub directory is looked up by
          // decision, not by position.
          val groupOf = active.map((path, config) => config.decisionId -> path).toMap
          BackendClient
            .runTests(active.map(_._2))
            .map(_.map(_.map: result =>
              val decisionId = result.fold(_.decisionId, _.dmnTables.dmnConfig.decisionId)
              groupOf.getOrElse(decisionId, "") -> result
            ))
        } --> { r =>
          AppState.busy.set(false)
          AppState.show(r, results => AppState.results.set(Some(results)))
        },
      // accepted test cases -> written into the *.conf
      AppState.saveRequests.events
        .withCurrentValueOf(AppState.selectedPath.signal)
        .flatMapSwitch { (groupPath, dmnConfig, path) =>
          val target = if groupPath.isEmpty then path else s"$path/$groupPath"
          BackendClient
            .updateConfig(dmnConfig, target)
            .map(result => (dmnConfig, target, result))
        } --> { (dmnConfig, target, result) =>
          AppState.show(
            result,
            groups =>
              AppState.configGroups.set(groups)
              AppState.saved.set(
                Some(
                  s"${dmnConfig.data.testCases.size} test case(s) saved to " +
                    s"$target/${dmnConfig.dmnConfigPathStr}"
                )
              )
          )
        },
      topBar,
      mainTag(
        cls := "content",
        child.maybe <-- AppState.problem.signal.map(_.map(problem)),
        child.maybe <-- AppState.saved.signal.map(
          _.map(msg => div(cls := "note info", msg))
        ),
        selectConfigPath,
        ConfigsView(runTestsBus.writer),
        child.maybe <-- AppState.results.signal.map(_.map(ResultsView.apply))
      ),
      footerTag(
        div(
          cls := "bar-inner",
          span(child.text <-- AppState.engineName),
          span(cls := "mono-break", child.text <-- AppState.basePath)
        )
      )
    )

  private lazy val topBar: HtmlElement =
    headerTag(
      cls := "topbar",
      div(
        cls := "bar-inner",
        span(cls := "brand", "Orchescala DMN Tester"),
        div(cls := "spacer"),
        a(
          cls := "sponsor",
          href := "https://z9nai.ch",
          target := "_blank",
          rel := "noopener noreferrer",
          title := "z9nai GmbH - z9nai.ch",
          span(cls := "muted", "by z9nai GmbH"),
          img(cls := "logo", src := "z9nai.png", alt := "z9nai GmbH")
        ),
        button(
          cls := "btn icon",
          tpe := "button",
          title <-- Theme.isDark.signal.map(dark =>
            if dark then "Light Mode" else "Dark Mode"
          ),
          child <-- Theme.isDark.signal.map(dark =>
            if dark then Icons.sun else Icons.moon
          ),
          onClick --> (_ => Theme.toggle())
        )
      )
    )

  private lazy val selectConfigPath: HtmlElement =
    div(
      cls := "card",
      h2(cls := "section-title", "1 - Path of your DMN Test Configurations"),
      div(
        cls := "row",
        select(
          value <-- AppState.selectedPath,
          onChange.mapToValue --> AppState.selectedPath,
          children <-- AppState.configPaths.signal.map(
            _.map(path => option(value := path, path))
          )
        ),
        button(
          cls := "btn",
          tpe := "button",
          Icons.refresh,
          "Reload",
          onClick --> (_ => AppState.selectedPath.update(identity))
        )
      ),
      div(
        cls := "muted mono-break",
        child.text <-- AppState.basePath.signal.map(p => s"Project: $p")
      )
    )

  private def problem(msg: String): HtmlElement =
    div(cls := "note error", pre(msg))
end Main
