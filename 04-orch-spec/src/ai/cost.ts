// What a change costs - the tokens of all requests of one change, priced like the concept
// (architecture.md «Kosten»): Claude Opus 5.5, as of October 2026. Shown in the chat, so the estimate
// (0.10–0.50 USD per change of a page) can be checked.

/** USD per million tokens - Claude Opus 5.5. Writing to the cache (5 minutes) costs 1.25 × input. */
export const PRICES = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } as const;

export type Usage = {
  /** input without the cache */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** requests to the API */
  requests: number;
  /** the models that answered instead of Opus 5.5 (server-side fallback after a refusal) - then the
    * cost is an estimate: it is priced like Opus 5.5 */
  fallbacks: string[];
};

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, fallbacks: [] };

/** The usage of one response of the API (`usage` of a message). A `fallback_message` entry in
  * `iterations` says another model served the response. */
export function usageOf(u: {
  input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
  iterations?: ReadonlyArray<{ type: string; model?: string | null }> | null;
}): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    requests: 1,
    fallbacks: (u.iterations ?? []).flatMap((i) => (i.type === 'fallback_message' ? [i.model ?? '?'] : [])),
  };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  requests: a.requests + b.requests,
  fallbacks: [...new Set([...a.fallbacks, ...b.fallbacks])],
});

export const costUsd = (u: Usage) =>
  (u.input * PRICES.input + u.output * PRICES.output + u.cacheRead * PRICES.cacheRead + u.cacheWrite * PRICES.cacheWrite) / 1_000_000;

/** `0.12 USD`, below one cent `0.004 USD`. */
export const formatUsd = (usd: number) => `${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)} USD`;

/** `12.3k` - for the chat. */
export const formatTokens = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`);

/** One line for the chat: «4 Anfragen · 18.2k ein (15.0k aus dem Cache) · 1.1k aus · 0.06 USD» -
  * with «(geschätzt) · beantwortet auch von …» when another model answered. */
export function usageLine(u: Usage): string {
  const all = u.input + u.cacheRead + u.cacheWrite;
  const cached = u.cacheRead ? ` (${formatTokens(u.cacheRead)} aus dem Cache)` : '';
  const other = u.fallbacks.length ? ` (geschätzt) · beantwortet auch von ${u.fallbacks.join(', ')}` : '';
  return `${u.requests} ${u.requests === 1 ? 'Anfrage' : 'Anfragen'} · ${formatTokens(all)} ein${cached} · ${formatTokens(u.output)} aus · ${formatUsd(costUsd(u))}${other}`;
}
