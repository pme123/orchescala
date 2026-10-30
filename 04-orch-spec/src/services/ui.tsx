// Small building blocks shared by the views of the services.
import type { HttpMethod } from './types';

/** Colour per HTTP method — the same everywhere in the services. */
export function methodTone(m: HttpMethod, isDark: boolean): string {
  const tone: Record<HttpMethod, [string, string]> = {
    GET: ['text-sky-300 border-sky-500/40', 'text-sky-700 border-sky-300'],
    POST: ['text-emerald-300 border-emerald-500/40', 'text-emerald-700 border-emerald-300'],
    PUT: ['text-amber-300 border-amber-500/40', 'text-amber-700 border-amber-300'],
    PATCH: ['text-violet-300 border-violet-500/40', 'text-violet-700 border-violet-300'],
    DELETE: ['text-rose-300 border-rose-500/40', 'text-rose-700 border-rose-300'],
  };
  return tone[m][isDark ? 0 : 1];
}

export function MethodChip({ method, isDark }: { method: HttpMethod; isDark: boolean }) {
  return <span className={`inline-block w-12 text-center text-[9px] font-mono font-bold px-1 py-px rounded border ${methodTone(method, isDark)}`}>{method}</span>;
}

