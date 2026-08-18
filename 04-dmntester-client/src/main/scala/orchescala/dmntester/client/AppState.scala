package orchescala.dmntester.client

import com.raquo.laminar.api.L.*
import orchescala.dmntester.HandledTesterException.EvalException
import orchescala.dmntester.{DmnConfig, DmnConfigGroup, DmnEvalResult}

/** Everything the UI needs to know. */
object AppState:

  val basePath: Var[String] = Var("")
  val engineName: Var[String] = Var("")
  val configPaths: Var[Seq[String]] = Var(Seq.empty)
  val selectedPath: Var[String] = Var("")
  val configGroups: Var[Seq[DmnConfigGroup]] = Var(Seq.empty)
  /** the results with the sub directory their config came from */
  val results: Var[Option[Seq[(String, Either[EvalException, DmnEvalResult])]]] =
    Var(None)
  val busy: Var[Boolean] = Var(false)
  val problem: Var[Option[String]] = Var(None)

  /** a DmnConfig the user wants to persist (accepted test cases) */
  val saveRequests: EventBus[(String, DmnConfig)] =
    new EventBus[(String, DmnConfig)]

  /** what was saved last - shown as a confirmation */
  val saved: Var[Option[String]] = Var(None)

  /** the checked configs with their sub directory */
  val activeConfigs: Signal[Seq[(String, DmnConfig)]] =
    configGroups.signal.map: groups =>
      groups.flatMap(group => group.configs.filter(_.isActive).map(group.path -> _))

  def show[A](result: Either[String, A], set: A => Unit): Unit =
    result match
      case Right(value) =>
        problem.set(None)
        set(value)
      case Left(msg) => problem.set(Some(msg))

  /** toggles `isActive` locally - the user runs what is checked. The same
    * decision can exist in several sub directories (e.g. c7 and c8), so the
    * group is part of the identity.
    */
  def toggleActive(groupPath: String, dmnConfig: DmnConfig, isActive: Boolean): Unit =
    configGroups.update(_.map:
      case group if group.path == groupPath =>
        group.copy(configs = group.configs.map:
          case c if c.decisionId == dmnConfig.decisionId =>
            c.copy(isActive = isActive)
          case c => c
        )
      case group => group
    )

  /** persists the rows the user accepted as the expected outputs - into the
    * sub directory the configuration came from.
    */
  def saveTestCases(
      groupPath: String,
      result: DmnEvalResult,
      rowIndexes: Set[Int]
  ): Unit =
    saveRequests.emit(groupPath -> result.configWithTestCases(rowIndexes))
end AppState
