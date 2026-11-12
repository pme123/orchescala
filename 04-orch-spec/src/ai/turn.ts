// One turn of the agent on the studio (E28, step 5): orch-spec sends the request of the RE, the draft
// and what the tools need; the studio runs the loop (agent.ts) with the tools of the task and the limits
// of its skill, and answers with the events as they come and the result at the end.
//
// What both sides need lives here: the tasks with a turn, the tools of each, the body of the request and
// the lines of the answer. The studio only transports - it sends each request of the loop to the Claude
// API with its key and the skill applied.
import type { BetaMessageParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Targets } from '../pages/designer/model';
import type { Page } from '../pages/runtime/spec';
import type { Model } from '../types';
import { checkDraft, runTurn, withPrompt, type AgentEvent, type Send, type TurnResult } from './agent';
import { NO_USAGE, type Usage } from './cost';
import { pageToolKit } from './pageTools';
import { processToolKit } from './processTools';
import { isObject, type ToolKit } from './toolkit';

/** The tasks whose loop can run on the studio - each with its tools. */
export const TURN_TASKS = ['uiCreator', 'processCreator', 'serviceOrchestrator'] as const;
export type TurnTask = (typeof TURN_TASKS)[number];

/** On the origin of the page, next to the route of the messages (config.ts). */
export const turnPath = (task: string) => `/ai/${task}/turn`;
/** The answer: one JSON per line. */
export const TURN_CONTENT_TYPE = 'application/x-ndjson';

/** What the tools of a task know besides the draft - read only. Pages: the targets (services, processes
  * …) and the other pages; processes: the catalog and, for an orchestration, the services it can call. */
export type TurnContext =
  | { targets: Targets; others: { slug: string; page: Page }[] }
  | { model: Model | null; services?: Targets['services'] };

/** The body of `POST /ai/<task>/turn`. `system` is the context of the conversation as orch-spec built it
  * at its start (it stays byte for byte the same - the cache); the instructions are the skill's. */
export type TurnRequest = {
  context: TurnContext;
  system: BetaTextBlockParam[];
  history: BetaMessageParam[];
  prompt: string;
  draft: unknown;
};

/** The limits of the skill for one turn - none: those of agent.ts (steps, corrections), no cost limit. */
export type TurnLimits = { maxSteps?: number; maxCorrections?: number; maxUsd?: number };

/** A request to the Claude API that failed - the status and the body of the API (or of the studio, in
  * the same form), so orch-spec reads it like an error of the API. */
export type TurnError = { status: number; body: unknown };

/** The result as it travels - its error as a TurnError. */
export type TurnOutcome = Omit<TurnResult<unknown>, 'error'> & { error?: TurnError };

/** A line of the answer: the events of the turn as they come, then one `result`. */
export type TurnLine = AgentEvent | { kind: 'result'; result: TurnOutcome };

/** An error in the form of the Claude API. */
export const apiErrorBody = (type: string, message: string) => ({ type: 'error', error: { type, message } });

/** What came back from `send` (or went wrong around it) as a TurnError - another error (a defect) as 500. */
export function turnError(e: unknown): TurnError {
  if (isObject(e) && typeof e.status === 'number' && 'body' in e) return { status: e.status, body: e.body };
  return { status: 500, body: apiErrorBody('api_error', e instanceof Error ? e.message : String(e)) };
}

export const outcomeOf = (r: TurnResult<unknown>): TurnOutcome => {
  const { error, ...rest } = r;
  return r.stop === 'error' ? { ...rest, error: turnError(error) } : rest;
};

/** The tools of `task` with its context - or what is wrong. An orchestration is a task of its own, not a
  * flag of the context: the browser cannot turn the tools of one into the other's. */
export function turnKit(task: string, context: unknown): ToolKit<unknown> | string {
  if (!(TURN_TASKS as readonly string[]).includes(task)) return `the task «${task}» has no turn on the studio`;
  if (!isObject(context)) return 'the context is no object';
  if (task === 'uiCreator') {
    const { targets, others } = context;
    if (!isObject(targets) || !Array.isArray(others)) return 'the context of pages needs targets and others';
    return pageToolKit({ targets: targets as Targets, others: others as { slug: string; page: Page }[] }) as ToolKit<unknown>;
  }
  const { model, services } = context;
  if (model !== null && model !== undefined && !isObject(model)) return 'the model of the context is no object';
  if (services !== undefined && !Array.isArray(services)) return 'the services of the context are no list';
  return processToolKit({
    model: (model ?? null) as Model | null,
    serviceMode: task === 'serviceOrchestrator',
    services: (services ?? []) as Targets['services'],
  }) as ToolKit<unknown>;
}

/** The request of orch-spec - or what is wrong with it. */
export function turnRequest(task: string, body: unknown): { request: TurnRequest; kit: ToolKit<unknown> } | string {
  if (!isObject(body)) return 'the body is no JSON object';
  const kit = turnKit(task, body.context);
  if (typeof kit === 'string') return kit;
  const { system, history, prompt, draft } = body;
  if (!Array.isArray(system)) return 'the system is no list of blocks';
  if (!Array.isArray(history)) return 'the history is no list of messages';
  if (typeof prompt !== 'string' || !prompt.trim()) return 'the prompt is no text';
  if (!isObject(draft)) return 'the draft is no object';
  return { request: body as unknown as TurnRequest, kit };
}

/** One turn on the studio: the loop with the tools of the task and the limits of the skill. */
export function serverTurn(
  { request, kit }: { request: TurnRequest; kit: ToolKit<unknown> },
  o: { send: Send; limits?: TurnLimits; onEvent?: (e: AgentEvent) => void; signal?: AbortSignal },
): Promise<TurnResult<unknown>> {
  return runTurn({
    send: o.send, system: request.system, kit, history: request.history, prompt: request.prompt, draft: request.draft,
    onEvent: o.onEvent, signal: o.signal,
    ...(o.limits?.maxSteps !== undefined ? { maxSteps: o.limits.maxSteps } : {}),
    ...(o.limits?.maxCorrections !== undefined ? { maxCorrections: o.limits.maxCorrections } : {}),
    ...(o.limits?.maxUsd !== undefined ? { maxUsd: o.limits.maxUsd } : {}),
  });
}

/** A turn that a defect of the loop ended (it threw) - as an error of the API would have ended it: the
  * history with the request, the draft as it was, the costs so far, and an error that says so. The
  * studio sends it as the result, so orch-spec does not read it as a lost connection. */
export function failedTurn({ request, kit }: { request: TurnRequest; kit: ToolKit<unknown> }, e: unknown, usage: Usage = NO_USAGE): TurnResult<unknown> {
  const message = e instanceof Error ? e.message : String(e);
  return {
    history: withPrompt(request.history, request.prompt), draft: request.draft, usage, stop: 'error', text: '',
    errors: checkDraft(kit, request.draft),
    error: { status: 500, body: apiErrorBody('api_error', `the turn failed on the studio: ${message}`) },
  };
}

/** A line of the answer - or undefined for one that is not (a newer studio, a broken line). */
export function parseTurnLine(text: string): TurnLine | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v) || typeof v.kind !== 'string') return undefined;
    if (v.kind === 'result') return isObject(v.result) && typeof v.result.stop === 'string' && Array.isArray(v.result.history) ? v as TurnLine : undefined;
    return ['text', 'tool', 'check', 'usage'].includes(v.kind) ? v as TurnLine : undefined;
  } catch {
    return undefined;
  }
}
