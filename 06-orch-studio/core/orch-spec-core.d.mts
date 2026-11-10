// The part of orch-spec's core (04-orch-spec/src/core) that the studio uses - the types of the bundle
// orch-spec-core.mjs next to this file (`npm run core`, built by esbuild from the TypeScript). Written by
// hand, narrow on purpose: the studio transports, the logic and its types are orch-spec's. The tests of
// the studio run against the real bundle (tests/turn.test.ts), so a change there that does not fit
// shows up there.

/** A DOMParser like the browser's - the studio passes linkedom's. */
export declare function installNodeDom(DOMParser: new () => { parseFromString(text: string, type: string): unknown }): void;

/** One request of the loop, without the settings - those are the skill's (model, thinking …). */
export type AgentRequest = { system: unknown[]; tools: { name: string }[]; messages: unknown[] };
/** One request of the loop to the Claude API - the message, or a TurnError (thrown). */
export type Send = (request: AgentRequest, signal?: AbortSignal) => Promise<unknown>;

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number; fallbacks: string[] };
export declare function costUsd(u: Usage): number;

export type Stop = 'done' | 'max_steps' | 'max_cost' | 'max_tokens' | 'context' | 'refusal' | 'cancelled' | 'error';
export type AgentEvent = { kind: 'text' | 'tool' | 'check' | 'usage' } & Record<string, unknown>;
export type TurnResult = { history: unknown[]; draft: unknown; usage: Usage; stop: Stop; text: string; errors: string[]; error?: unknown };

/** A failed request: the status and the body of the API (or of the studio, in the same form). */
export type TurnError = { status: number; body: unknown };
export type TurnOutcome = Omit<TurnResult, 'error'> & { error?: TurnError };
export type TurnLine = AgentEvent | { kind: 'result'; result: TurnOutcome };
export type TurnLimits = { maxSteps?: number; maxCorrections?: number; maxUsd?: number };

/** The request of orch-spec, checked, with the tools of its task. */
export type CheckedTurn = { request: unknown; kit: { tools: { name: string }[] } };

export declare const TURN_TASKS: readonly string[];
export declare const TURN_CONTENT_TYPE: string;
export declare function apiErrorBody(type: string, message: string): { type: 'error'; error: { type: string; message: string } };
export declare function turnRequest(task: string, body: unknown): CheckedTurn | string;
export declare function serverTurn(
  turn: CheckedTurn,
  o: { send: Send; limits?: TurnLimits; onEvent?: (e: AgentEvent) => void; signal?: AbortSignal },
): Promise<TurnResult>;
export declare function outcomeOf(r: TurnResult): TurnOutcome;
