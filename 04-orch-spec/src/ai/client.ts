// The Claude API through the studio (E23): the SDK of Anthropic in the browser, but its requests go to
// the studio - to the route of their task (`/ai/uiCreator`) - which applies the skill of the task
// (its instructions first in the system, its model, thinking, effort, fallbacks and tools) and sends
// them on with its key - the browser has none. The agent (agent.ts) stays here for now; later the
// skill runs on the studio as a whole - only `send` changes.
import Anthropic from '@anthropic-ai/sdk';
import type { Send } from './agent';
import { messagesBase, type AiConfig, type AiTask } from './config';

/** The model if the studio names none - the skill decides anyway. */
export const MODEL = 'claude-opus-5-5';

/** The address of the studio for the SDK - the route of `task`, on the origin of the page, which the studio serves. */
export const studioBaseUrl = (task: AiTask, origin: string = globalThis.location?.origin ?? 'http://localhost') =>
  new URL(messagesBase(task), origin).href;

/** `send` for the agent: one request of `task`. Without streaming - the answers are short (a block,
  * a few sentences); the API validates the tool inputs before it returns them. Key, workspace, model
  * and settings are the studio's (the skill) - the SDK wants a key and a model, it gets a placeholder
  * and the model the studio named. The system holds only the context (catalog, data model): the
  * instructions are the skill's. */
export function claudeSender(config: AiConfig, task: AiTask): Send {
  const client = new Anthropic({ apiKey: 'from-the-studio', baseURL: studioBaseUrl(task), dangerouslyAllowBrowser: true });
  return (request, signal) =>
    client.beta.messages.create({
      model: config.skills[task]?.model ?? config.model ?? MODEL,
      max_tokens: 16000,
      // the growing conversation; the system blocks carry their own breakpoints (context.ts)
      cache_control: { type: 'ephemeral' },
      system: request.system,
      tools: request.tools,
      messages: request.messages,
    }, { signal });
}

/** The error of the API (or of the studio, in the same form) - type and message of its body. */
function apiError(e: InstanceType<typeof Anthropic.APIError>): { type?: string; message: string } {
  const inner = (e.error as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
  return {
    type: typeof inner?.type === 'string' ? inner.type : undefined,
    message: typeof inner?.message === 'string' ? inner.message : e.message,
  };
}

/** What the RE reads when a request fails. */
export function errorText(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'Abgebrochen.';
  if (e instanceof Anthropic.AuthenticationError) return 'Der API-Key des Studios wird nicht angenommen – STUDIO_AI_ANTHROPIC_API_KEY auf dem Server prüfen.';
  if (e instanceof Anthropic.PermissionDeniedError && apiError(e).message.includes('no skill in the studio'))
    return 'Für diese Aufgabe hat das Studio keinen Skill – neu laden.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Der API-Key des Studios darf das Modell nicht verwenden (403).';
  if (e instanceof Anthropic.NotFoundError && e.message.includes('AI of the studio is off'))
    return 'Die KI ist im Studio ausgeschaltet – neu laden.';
  if (e instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen (429) – kurz warten und nochmals versuchen.';
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message))
    return 'Das Guthaben des API-Keys des Studios ist aufgebraucht – in der Anthropic Console (Billing) aufladen.';
  if (e instanceof Anthropic.BadRequestError && e.message.includes('anthropic-workspace-id'))
    return 'Der Key des Studios ist keinem Workspace zugeordnet – auf dem Server STUDIO_AI_ANTHROPIC_WORKSPACE_ID setzen.';
  if (e instanceof Anthropic.BadRequestError && apiError(e).message.includes('are not in the skill'))
    return `Der Skill des Studios erlaubt ein Werkzeug nicht – orch-spec und Studio passen nicht zusammen: ${apiError(e).message}`;
  if (e instanceof Anthropic.BadRequestError) return `Die Anfrage wurde abgelehnt (400): ${apiError(e).message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zum Studio.';
  // what the studio answers itself when the Claude API does not (AiRoutes)
  if (e instanceof Anthropic.APIError && e.status === 502 && apiError(e).type === 'api_error')
    return 'Das Studio erreicht die Claude API nicht (502) – Netz des Servers oder STUDIO_AI_ANTHROPIC_URL prüfen.';
  if (e instanceof Anthropic.APIError && e.status === 504)
    return 'Die Claude API hat nicht rechtzeitig geantwortet (504) – nochmals versuchen.';
  if (e instanceof Anthropic.APIError) return `Fehler der Claude API (${e.status ?? '?'}): ${apiError(e).message}`;
  return e instanceof Error ? e.message : String(e);
}
