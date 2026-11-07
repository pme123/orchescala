package orchescala.orchstudio

/** The AI of the studio (E23) - the key stays on the server. orch-spec only learns that the AI is on
  * and which model answers (`GET /ai/config`); its requests go through the studio (see [[AiRoutes]]).
  * Without it, orch-spec shows nothing of AI.
  *
  * @param apiKey      the key of the Claude API - the company's, not a person's
  * @param workspaceId only for a key that is not scoped to a workspace - the API then wants it
  * @param model       the model the studio asks - whatever orch-spec sends
  * @param baseUrl     the Claude API - another one for a gateway of the company (or a test)
  */
final case class AiConfig(
    apiKey: String,
    workspaceId: Option[String] = None,
    model: String = AiConfig.defaultModel,
    baseUrl: String = AiConfig.anthropicUrl
):
  /** Never the key - the settings end up in logs. */
  override def toString: String =
    s"AiConfig(anthropic, $model${workspaceId.fold("")(w => s", workspace $w")}, $baseUrl)"

object AiConfig:
  val defaultModel = "claude-opus-5-5"
  val anthropicUrl = "https://api.anthropic.com"

  /** From the environment - None without `STUDIO_AI_ANTHROPIC_API_KEY`: then the AI is off.
    *
    *   - `STUDIO_AI_ANTHROPIC_API_KEY` the key (switch)
    *   - `STUDIO_AI_ANTHROPIC_WORKSPACE_ID` only if the API asks for it
    *   - `STUDIO_AI_MODEL` default [[defaultModel]]
    *   - `STUDIO_AI_ANTHROPIC_URL` default [[anthropicUrl]]
    */
  def fromEnv(env: Map[String, String]): Option[AiConfig] =
    def get(name: String) = env.get(name).map(_.trim).filter(_.nonEmpty)
    get("STUDIO_AI_ANTHROPIC_API_KEY").map: key =>
      AiConfig(
        apiKey = key,
        workspaceId = get("STUDIO_AI_ANTHROPIC_WORKSPACE_ID"),
        model = get("STUDIO_AI_MODEL").getOrElse(defaultModel),
        baseUrl = get("STUDIO_AI_ANTHROPIC_URL").map(_.stripSuffix("/")).getOrElse(anthropicUrl)
      )
end AiConfig
