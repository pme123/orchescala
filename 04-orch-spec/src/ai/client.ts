// The Claude API from the browser - with the personal key of the person in front of it (E20). orch-spec
// has no backend: the request goes straight from the browser to Anthropic (`dangerouslyAllowBrowser` -
// acceptable with one's own key, the key belongs to the person in front of the browser). Later a
// proxy (gateway, Bedrock, Vertex) can take its place - only `send` changes.
import Anthropic from '@anthropic-ai/sdk';
import type { Send } from './agent';

export const MODEL = 'claude-opus-5-5';

/** `send` for the agent: one request, the fixed settings here. Without streaming - the answers are
  * short (a block, a few sentences); the API validates the tool inputs before it returns them.
  * `workspaceId` only for a key that is not scoped to a workspace - the API then wants it in a header. */
export function claudeSender(apiKey: string, workspaceId?: string | null): Send {
  const client = new Anthropic({
    apiKey, dangerouslyAllowBrowser: true,
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
  });
  return (request, signal) =>
    client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // thinking is always on with Opus 5.5 - effort says how much; editing a page is routine work
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      // if a safety classifier declines, the API retries on a fitting model within the same request
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // the growing conversation; the two system blocks carry their own breakpoints (context.ts)
      cache_control: { type: 'ephemeral' },
      system: request.system,
      tools: request.tools,
      messages: request.messages,
    }, { signal });
}

/** What the RE reads when a request fails. */
export function errorText(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'Abgebrochen.';
  if (e instanceof Anthropic.AuthenticationError) return 'Der API-Key wird nicht angenommen – in den Einstellungen prüfen.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Der API-Key darf das Modell nicht verwenden (403).';
  if (e instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen (429) – kurz warten und nochmals versuchen.';
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message))
    return 'Das Guthaben des API-Keys ist aufgebraucht – in der Anthropic Console (Billing) aufladen.';
  if (e instanceof Anthropic.BadRequestError && e.message.includes('anthropic-workspace-id'))
    return 'Der Key ist keinem Workspace zugeordnet – im KI-Dialog (✦ oben rechts) die Workspace-ID eintragen oder einen Key in einem Workspace erstellen.';
  if (e instanceof Anthropic.BadRequestError) return `Die Anfrage wurde abgelehnt (400): ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zur Claude API.';
  if (e instanceof Anthropic.APIError) return `Fehler der Claude API (${e.status ?? '?'}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
