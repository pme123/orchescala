// Search across all fields and the similarity check when creating an error.
import type { ErrorEntry } from './types';
import { plainText } from './markdown';

export const FIELD_LABEL: Record<string, string> = {
  process: 'Prozess', title: 'Kurzbeschrieb', details: 'Details', activity: 'Aktivität',
  reporter: 'Erfasser', status: 'Status', ticket: 'Ticket', workaround: 'Workaround', id: 'ID',
};

const FIELDS = ['title', 'process', 'activity', 'status', 'ticket', 'reporter', 'workaround', 'details', 'id'] as const;

function fieldText(e: ErrorEntry, f: typeof FIELDS[number]): string {
  if (f === 'status') return e.status.join(' ');
  if (f === 'details' || f === 'workaround' || f === 'ticket') return plainText(e[f]);
  return String(e[f] ?? '');
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function terms(q: string): string[] {
  return norm(q).split(/\s+/).filter(Boolean);
}

/** All search terms must occur (in any field). */
export function matches(e: ErrorEntry, ts: string[]): boolean {
  if (!ts.length) return true;
  const hay = norm(FIELDS.map(f => fieldText(e, f)).join('\n'));
  return ts.every(t => hay.includes(t));
}

/** Where is the hit, if not in title/process? For the preview in the list. */
export function snippet(e: ErrorEntry, ts: string[]): { field: string; text: string } | null {
  if (!ts.length) return null;
  const visible = norm(`${e.title} ${e.process} ${e.activity} ${e.status.join(' ')}`);
  const missing = ts.filter(t => !visible.includes(t));
  if (!missing.length) return null;
  for (const f of ['workaround', 'details', 'ticket', 'reporter', 'id'] as const) {
    const txt = fieldText(e, f);
    const i = norm(txt).indexOf(missing[0]);
    if (i < 0) continue;
    const from = Math.max(0, i - 50);
    const to = Math.min(txt.length, i + missing[0].length + 90);
    return { field: FIELD_LABEL[f], text: `${from > 0 ? '…' : ''}${txt.slice(from, to)}${to < txt.length ? '…' : ''}` };
  }
  return null;
}

/** Split text into pieces with hits marked — without building HTML. */
export function highlight(text: string, ts: string[]): { s: string; hit: boolean }[] {
  if (!ts.length || !text) return [{ s: text, hit: false }];
  const n = norm(text);
  const marks = new Array(text.length).fill(false);
  for (const t of ts) {
    for (let i = n.indexOf(t); i >= 0; i = n.indexOf(t, i + 1)) for (let k = i; k < i + t.length; k++) marks[k] = true;
  }
  const out: { s: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.s += text[i];
    else out.push({ s: text[i], hit: marks[i] });
  }
  return out;
}

// ── Similar errors (when creating) ──────────────────────────────────────────
const STOP = new Set(['der', 'die', 'das', 'und', 'oder', 'bei', 'mit', 'von', 'kann', 'nicht', 'ein', 'eine', 'the', 'and', 'for', 'with', 'error', 'fehler', 'code', 'response', 'non', 'json', 'valid', 'http', 'https']);

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t) || /^\d{3,5}$/.test(t)));
}

export function similar(draft: Pick<ErrorEntry, 'process' | 'title' | 'details' | 'activity'>, all: ErrorEntry[], exceptId?: string) {
  const d = tokens(`${draft.title} ${draft.activity} ${plainText(draft.details).slice(0, 600)}`);
  if (d.size < 1 && !draft.process.trim()) return [];
  const p = norm(draft.process.trim());
  return all
    .filter(e => e.id !== exceptId && !e.archived)
    .map(e => {
      const o = tokens(`${e.title} ${e.activity} ${plainText(e.details).slice(0, 600)}`);
      let common = 0;
      d.forEach(t => { if (o.has(t)) common++; });
      const overlap = d.size ? common / Math.min(d.size, o.size || 1) : 0;
      const sameProcess = p && norm(e.process) === p ? 0.25 : 0;
      return { e, score: overlap + sameProcess };
    })
    .filter(x => x.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}
