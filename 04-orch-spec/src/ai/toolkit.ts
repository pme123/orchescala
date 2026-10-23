// What the agent (agent.ts) needs of a kind of spec - the pages (pageTools.ts) or a process
// (processTools.ts): the tools Claude may call, how they change a draft, and what still counts as an
// error. The tools work only on the draft - never on the folder, an environment, data or code (E19).
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** The result of a tool: the draft afterwards, the answer for Claude and one line for the chat. */
export type ToolOutcome<D> = {
  draft: D;
  /** the answer for Claude - JSON or text */
  content: string;
  isError?: boolean;
  /** for the chat, German: «Feld «Filiale» eingefügt» */
  summary: string;
};

export type ToolKit<D> = {
  tools: BetaTool[];
  run: (name: string, input: unknown, draft: D) => ToolOutcome<D>;
  /** the errors of the draft that Claude has to correct before the RE sees it - [] if none (or nothing changed) */
  remainingErrors: (draft: D) => string[];
};

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A tool that does not change the draft, with an error for Claude. */
export const failed = <D>(draft: D, message: string, summary = message): ToolOutcome<D> =>
  ({ draft, content: message, isError: true, summary });

/** The JSON for Claude - compact, keys in the order of the object (deterministic). */
export const json = (v: unknown) => JSON.stringify(v);
