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
};

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };

/** The usage of one response of the API (`usage` of a message). */
export function usageOf(u: {
  input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
}): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    requests: 1,
  };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  requests: a.requests + b.requests,
});

export const costUsd = (u: Usage) =>
  (u.input * PRICES.input + u.output * PRICES.output + u.cacheRead * PRICES.cacheRead + u.cacheWrite * PRICES.cacheWrite) / 1_000_000;

/** `0.12 USD`, below one cent `0.004 USD`. */
export const formatUsd = (usd: number) => `${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)} USD`;

/** `12.3k` - for the chat. */
export const formatTokens = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`);

/** One line for the chat: «4 Anfragen · 18.2k ein (15.0k aus dem Cache) · 1.1k aus · 0.06 USD». */
export function usageLine(u: Usage): string {
  const all = u.input + u.cacheRead + u.cacheWrite;
  const cached = u.cacheRead ? ` (${formatTokens(u.cacheRead)} aus dem Cache)` : '';
  return `${u.requests} ${u.requests === 1 ? 'Anfrage' : 'Anfragen'} · ${formatTokens(all)} ein${cached} · ${formatTokens(u.output)} aus · ${formatUsd(costUsd(u))}`;
}
