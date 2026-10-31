// Names from an API to names in the app and in Scala — one rule for parameters, fields and headers.

export const capitalize = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());
export const lowerFirst = (s: string) => s.replace(/^(.)/, c => c.toLowerCase());

/** `request-id` → `requestId`, `X-Client_Key` → `xClientKey` */
export function camelName(raw: string): string {
  const parts = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return 'value';
  const s = parts.map((p, i) => (i ? capitalize(p) : p)).join('');
  // a name that starts with a digit is no Scala identifier
  return /^[0-9]/.test(s) ? `v${s}` : lowerFirst(s);
}

/**
 * A header of the response as FEEL reads it: `X-Finnova-Transaction-Id` → `headers.xFinnovaTransactionId`,
 * `etag` → `headers.etag`. The worker finds it by its real name, whatever the case.
 */
export const headerVar = (header: string): string => camelName(header);
