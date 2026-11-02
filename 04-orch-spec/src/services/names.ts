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
 * A header of the response as FEEL reads it: `X-Core-Transaction-Id` → `headers.xCoreTransactionId`,
 * `etag` → `headers.etag`. The worker finds it by its real name, whatever the case.
 */
export const headerVar = (header: string): string => camelName(header);

// ── Names of imported types and services ────────────────────────────────────
//
// As the OpenAPI generator of the helper (`./helper.scala`) names them, without
// what generated APIs repeat:
//   · a type: its schema name, without a leading part that comes again in the
//     rest (also in the singular) — the package of a generated API in front of
//     its message: `MultipleNaturalPersonsReadMultipleNaturalPerson2Request`
//     → `ReadMultipleNaturalPerson2Request`, `NaturalPersonNaturalPerson3`
//     → `NaturalPerson3`; `NaturalPersonGender1` stays
//   · a service: the HTTP method first, then its operationId (or the fixed
//     segments of its path) without such a repeated part:
//     `POST MultipleNaturalPersons_ReadMultipleNaturalPerson2`
//     → `PostReadMultipleNaturalPerson2`; `GET getClient` → `GetClient`

/** the words of a name in CamelCase — a digit stays with its word (`Person2`) */
const words = (name: string): string[] => name.match(/[A-Z][a-z0-9]*|[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [name];

const singularWord = (w: string): string => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** `MultipleNaturalPersonsReadMultipleNaturalPerson2Request` → `ReadMultipleNaturalPerson2Request` */
export function withoutRepeatedPrefix(name: string): string {
  const ws = words(name);
  // the longest leading part first: `NaturalPerson` before `Natural`
  for (let k = ws.length - 1; k >= 1; k--) {
    const prefix = ws.slice(0, k).join('');
    const rest = ws.slice(k);
    const forms = new Set([prefix, [...ws.slice(0, k - 1), singularWord(ws[k - 1])].join('')]);
    // the part again in the rest — from the start of one of its words
    for (let i = 0; i < rest.length; i++) {
      const from = rest.slice(i).join('');
      if ([...forms].some(f => from.startsWith(f))) return rest.join('');
    }
  }
  return name;
}

/** `POST` + `ReadMultipleNaturalPerson2` → `PostReadMultipleNaturalPerson2` — the method not twice */
export function withMethod(method: string, name: string): string {
  const m = capitalize(method.toLowerCase());
  return words(name)[0] === m ? name : `${m}${name}`;
}
