// The conversation with Claude for one request of the RE: Claude reads the spec, changes the draft
// with the tools of a ToolKit, and is sent back as long as the draft has errors that the change
// brought (as the designer reports them) - at most a few times. The draft only goes to the RE
// afterwards; accepting or discarding is the RE's (E19).
//
// Without network: `send` is passed in - in the app the Anthropic SDK (client.ts), in the tests a mock.
// The history is only appended to (thinking blocks stay valid), never edited.
import type {
  BetaContentBlock, BetaMessage, BetaMessageParam, BetaTextBlockParam, BetaTool, BetaToolResultBlockParam, BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { addUsage, NO_USAGE, usageOf, type Usage } from './cost';
import type { ToolKit } from './toolkit';

/** What a request needs besides the fixed settings (model, effort …) - those are added by `send`. */
export type AgentRequest = { system: BetaTextBlockParam[]; tools: BetaTool[]; messages: BetaMessageParam[] };
export type Send = (request: AgentRequest, signal?: AbortSignal) => Promise<BetaMessage>;

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; summary: string; isError: boolean }
  /** the check found errors - Claude gets them back to correct */
  | { kind: 'check'; errors: string[] }
  /** after every request: the usage of the whole turn so far */
  | { kind: 'usage'; usage: Usage };

export type Stop = 'done' | 'max_steps' | 'max_tokens' | 'refusal' | 'cancelled' | 'error';

export type TurnResult<D> = {
  history: BetaMessageParam[];
  draft: D;
  usage: Usage;
  stop: Stop;
  /** the text of Claude in this turn */
  text: string;
  /** errors of the draft that are still there at the end (after the corrections) */
  errors: string[];
  /** with stop 'error': what went wrong */
  error?: unknown;
};

/** At most this many requests per turn - a loop that does not end costs money. */
export const MAX_STEPS = 24;
/** This often Claude is sent back because of errors in the draft. */
export const MAX_CORRECTIONS = 2;

type State<D> = { history: BetaMessageParam[]; draft: D; usage: Usage; steps: number; corrections: number; text: string[] };

const textOf = (content: BetaContentBlock[]) =>
  content.flatMap((b) => (b.type === 'text' && b.text.trim() ? [b.text.trim()] : []));

export const correctionPrompt = (errors: string[]) =>
  `Die Prüfung des Entwurfs meldet noch Fehler:\n${errors.map((e) => `- ${e}`).join('\n')}\n` +
  'Korrigiere sie mit den Werkzeugen. Geht es in der Spez nicht (z.B. ein Service fehlt), melde es mit report_open_point und nimm den Teil wieder heraus.';

export async function runTurn<D>(o: {
  send: Send;
  system: BetaTextBlockParam[];
  kit: ToolKit<D>;
  history: BetaMessageParam[];
  prompt: string;
  draft: D;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  maxCorrections?: number;
}): Promise<TurnResult<D>> {
  const maxSteps = o.maxSteps ?? MAX_STEPS;
  const maxCorrections = o.maxCorrections ?? MAX_CORRECTIONS;
  const emit = (e: AgentEvent) => o.onEvent?.(e);
  const end = (s: State<D>, stop: Stop, error?: unknown): TurnResult<D> => ({
    history: s.history, draft: s.draft, usage: s.usage, stop, text: s.text.join('\n\n'), errors: o.kit.remainingErrors(s.draft),
    ...(error !== undefined ? { error } : {}),
  });

  const step = async (s: State<D>): Promise<TurnResult<D>> => {
    if (o.signal?.aborted) return end(s, 'cancelled');
    if (s.steps >= maxSteps) return end(s, 'max_steps');
    const sent = await o.send({ system: o.system, tools: o.kit.tools, messages: s.history }, o.signal)
      .then((message) => ({ message }), (error: unknown) => ({ error }));
    if ('error' in sent) return end(s, o.signal?.aborted ? 'cancelled' : 'error', sent.error);
    const response = sent.message;
    const usage = addUsage(s.usage, usageOf(response.usage));
    emit({ kind: 'usage', usage });
    const said = textOf(response.content);
    said.forEach((text) => emit({ kind: 'text', text }));
    const calls = response.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
    const assistant: BetaMessageParam = { role: 'assistant', content: response.content };
    const next: State<D> = { ...s, usage, steps: s.steps + 1, text: [...s.text, ...said] };

    // a refusal or an answer cut off can end in the middle of a tool call - never run those, and
    // keep the history without that answer (a tool_use without its result would break the next request)
    if (response.stop_reason === 'refusal') return end(next, 'refusal');
    if (response.stop_reason === 'max_tokens') return end(calls.length ? next : { ...next, history: [...s.history, assistant] }, 'max_tokens');
    if (response.stop_reason === 'pause_turn') return step({ ...next, history: [...s.history, assistant] });

    if (calls.length) {
      // one after the other - each tool sees the draft of the previous one
      const ran = calls.reduce<{ draft: D; results: BetaToolResultBlockParam[] }>((acc, call) => {
        const r = o.kit.run(call.name, call.input, acc.draft);
        emit({ kind: 'tool', name: call.name, summary: r.summary, isError: !!r.isError });
        return {
          draft: r.draft,
          results: [...acc.results, { type: 'tool_result', tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) }],
        };
      }, { draft: s.draft, results: [] });
      return step({ ...next, draft: ran.draft, history: [...s.history, assistant, { role: 'user', content: ran.results }] });
    }

    // Claude is done - but the draft goes to the RE only without errors of its own
    const errors = o.kit.remainingErrors(next.draft);
    if (errors.length && s.corrections < maxCorrections) {
      emit({ kind: 'check', errors });
      return step({
        ...next,
        corrections: s.corrections + 1,
        history: [...s.history, assistant, { role: 'user', content: correctionPrompt(errors) }],
      });
    }
    return end({ ...next, history: [...s.history, assistant] }, 'done');
  };

  return step({ history: [...o.history, { role: 'user', content: o.prompt }], draft: o.draft, usage: NO_USAGE, steps: 0, corrections: 0, text: [] });
}
