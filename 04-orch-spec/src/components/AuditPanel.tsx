// Verlauf — das Änderungsprotokoll der Spezifikation (siehe audit.ts) als
// Panel rechts, wie die Kommentare: neueste Einträge oben, je Eintrag wer,
// wann, woher (von Hand, Abgleich, Umwandlung, beim Laden) und was — Stelle,
// Feld, vorher → nachher. Filtern lässt es sich nach Element (ein Schritt,
// ein Typ …), nach Person, nach Zeitraum, nach Herkunft und mit einer
// Textsuche; ein Klick
// auf die Stelle springt hin.
import { useEffect, useMemo, useState } from 'react';
import { History, Loader2, Search, X } from 'lucide-react';
import { auditBase, coalesce, SOURCE_LABEL, type AuditChange, type AuditEntry, type AuditSource } from '../audit';
import { allSteps } from '../bpmn';
import { commentTargets, whenFull, whenLabel } from '../comments';
import type { ProcessSpec } from '../types';
import { PanelWidthHandle, cls } from '../ui';

interface Props {
  slug: string;
  /** Version der Spezifikation — nach jedem Speichern wird neu gelesen */
  version: string | null;
  spec: ProcessSpec;
  isDark: boolean;
  load: (slug: string) => Promise<AuditEntry[] | null>;
  /** Element-Stelle (`step:<id>`, `type:<id>` …) oder null = alle */
  focus: string | null;
  onFocus: (base: string | null) => void;
  onGoto: (target: string) => void;
  onClose: () => void;
  width: number;
  onWidth: (w: number) => void;
  overlay: boolean;
}

const SOURCES: AuditSource[] = ['manual', 'bpmn-sync', 'domain-sync', 'conversion', 'load'];

type Range = 'all' | 'today' | '7' | '30' | 'custom';
// als Liste: Object.keys stellte die Zahlen-Schlüssel ('7', '30') nach vorn
const RANGES: Range[] = ['all', 'today', '7', '30', 'custom'];
const RANGE_LABEL: Record<Range, string> = { all: 'Jederzeit', today: 'Heute', 7: 'Letzte 7 Tage', 30: 'Letzte 30 Tage', custom: 'Zeitraum …' };

/** Lokaler Tagesanfang von `yyyy-mm-dd` (bzw. heute minus `days`) in ms. */
const dayStart = (iso?: string, days = 0): number => {
  const d = iso ? new Date(`${iso}T00:00:00`) : new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
};

/** Von–bis in ms (bis exklusiv) — null = keine Grenze. */
function bounds(range: Range, from: string, to: string): [number | null, number | null] {
  switch (range) {
    case 'today': return [dayStart(), null];
    case '7': return [dayStart(undefined, 6), null];
    case '30': return [dayStart(undefined, 29), null];
    case 'custom': return [from ? dayStart(from) : null, to ? dayStart(to, -1) : null];
    default: return [null, null];
  }
}

const sourceTone = (s: AuditSource, isDark: boolean) => ({
  manual: isDark ? 'border-white/20 text-white/60' : 'border-black/20 text-black/60',
  'bpmn-sync': isDark ? 'border-blue-500/40 text-blue-300' : 'border-blue-300 text-blue-700',
  'domain-sync': isDark ? 'border-violet-500/40 text-violet-300' : 'border-violet-300 text-violet-700',
  conversion: isDark ? 'border-amber-500/40 text-amber-300' : 'border-amber-300 text-amber-700',
  load: isDark ? 'border-white/15 text-white/40' : 'border-black/15 text-black/40',
}[s]);

export default function AuditPanel(p: Props) {
  const { spec, isDark, focus } = p;
  const c = cls(isDark);
  const iconBtn = `p-1 rounded transition-colors ${isDark ? 'text-white/40 hover:text-white' : 'text-black/40 hover:text-black'}`;

  const [entries, setEntries] = useState<AuditEntry[] | null | undefined>(undefined);
  const [hidden, setHidden] = useState<Set<AuditSource>>(new Set());
  /** Person (Name) oder '' = alle */
  const [who, setWho] = useState('');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<Range>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // nach jedem Speichern neu lesen — das Protokoll wächst mit
  const { load, slug, version } = p;
  useEffect(() => {
    let alive = true;
    load(slug).then(e => { if (alive) setEntries(e); });
    return () => { alive = false; };
  }, [load, slug, version]);

  // Esc schliesst (ausser beim Tippen in einem Feld)
  const onClose = p.onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Die Stellen, die es heute gibt — mit ihrem heutigen Namen
  const current = useMemo(() => new Map(commentTargets(spec, allSteps(spec.steps)).map(t => [t.key, t.label])), [spec]);

  const merged = useMemo(() => (entries ? coalesce(entries) : []), [entries]);

  // Elemente im Protokoll — für die Auswahl; heutiger Name, sonst der letzte bekannte
  const elements = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of merged) for (const ch of e.changes) {
      const base = auditBase(ch.target);
      if (!m.has(base)) m.set(base, current.get(base) ?? (ch.target === base ? ch.label : ch.label.split(' · ')[0]));
    }
    if (focus && !m.has(focus)) m.set(focus, current.get(focus) ?? focus);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'));
  }, [merged, current, focus]);

  // wer im Protokoll vorkommt — neueste zuerst gesehen, alphabetisch gezeigt
  const authors = useMemo(() => [...new Set(merged.map(e => e.author))].sort((a, b) => a.localeCompare(b, 'de')), [merged]);

  /**
   * Textsuche: alle Wörter müssen vorkommen. Passen Person, Notiz oder
   * Bericht, bleibt der ganze Eintrag; sonst nur die Änderungen, die passen
   * (Stelle, Feld, vorher, nachher).
   */
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (text: string) => { const t = text.toLowerCase(); return words.every(w => t.includes(w)); };
    const changeText = (ch: AuditChange) => [ch.label, ch.field, ch.before, ch.after].filter(Boolean).join(' ');
    const [lo, hi] = bounds(range, from, to);
    const inRange = (at: string) => { const t = new Date(at).getTime(); return (lo == null || t >= lo) && (hi == null || t < hi); };
    return merged
      .filter(e => !hidden.has(e.source) && (!who || e.author === who) && inRange(e.at))
      .map(e => (focus ? { ...e, changes: e.changes.filter(ch => auditBase(ch.target) === focus) } : e))
      .map(e => {
        if (!words.length) return e;
        const head = [e.author, e.email, e.note, SOURCE_LABEL[e.source], ...Object.entries(e.report ?? {}).flat(2)].filter(Boolean).join(' ');
        if (hit(head)) return e;
        return { ...e, changes: e.changes.filter(ch => hit(`${head} ${changeText(ch)}`)) };
      })
      .filter(e => e.changes.length);
  }, [merged, hidden, focus, who, query, range, from, to]);
  const filtered = !!focus || !!who || !!query.trim() || hidden.size > 0 || range !== 'all';

  const toggleSource = (s: AuditSource) => setHidden(prev => {
    const n = new Set(prev);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });

  return (
    <aside style={{ width: p.width }}
      className={`flex-shrink-0 flex flex-col min-h-0 border-l ${c.border} ${c.panelStrong} ${
        p.overlay ? 'absolute right-0 top-0 bottom-0 z-30 shadow-2xl max-w-[85vw]' : 'relative max-w-[45vw]'}`}>
      <PanelWidthHandle isDark={isDark} width={p.width} onWidth={p.onWidth} min={300} max={640} />
      <div className={`px-3 py-2 border-b ${c.border} flex items-center gap-1.5`}>
        <History size={13} className={c.muted} />
        <span className={`text-xs font-semibold flex-1 min-w-0 truncate ${c.text}`}>
          Verlauf
          {entries && <span className={`ml-2 text-[10px] font-normal ${c.muted}`}>{shown.length} {shown.length === 1 ? 'Eintrag' : 'Einträge'}</span>}
        </span>
        <button type="button" onClick={onClose} title="Schliessen (Esc)" className={iconBtn}><X size={13} /></button>
      </div>

      {/* Filter: Element und Herkunft */}
      <div className={`px-3 py-1.5 border-b ${c.border} space-y-1.5`}>
        <div className="relative">
          <Search size={11} className={`absolute left-2 top-1/2 -translate-y-1/2 ${c.muted}`} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Suchen — Stelle, Feld, Wert, Notiz …"
            className={`w-full text-[11px] pl-6 pr-6 py-1 rounded border outline-none ${c.input}`} />
          {query && (
            <button type="button" onClick={() => setQuery('')} title="Suche leeren"
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${c.muted}`}><X size={11} /></button>
          )}
        </div>
        <div className="flex gap-1.5">
          <select value={focus ?? ''} onChange={e => p.onFocus(e.target.value || null)}
            title="Nur die Änderungen an diesem Element"
            className={`flex-1 min-w-0 text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
            <option value="">Alle Stellen</option>
            {elements.map(([key, label]) => <option key={key} value={key}>{label}{current.has(key) ? '' : ' (entfallen)'}</option>)}
          </select>
          <select value={who} onChange={e => setWho(e.target.value)}
            title="Nur die Änderungen dieser Person"
            className={`flex-1 min-w-0 text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
            <option value="">Alle Personen</option>
            {authors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={range} onChange={e => setRange(e.target.value as Range)}
            title="Nur Änderungen in diesem Zeitraum"
            className={`flex-1 min-w-0 text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
            {RANGES.map(r => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
          </select>
        </div>
        {range === 'custom' && (
          <div className={`flex items-center gap-1.5 text-[10px] ${c.muted}`}>
            <span>von</span>
            <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}
              className={`flex-1 min-w-0 text-[11px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
            <span>bis</span>
            <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)}
              className={`flex-1 min-w-0 text-[11px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {SOURCES.map(s => (
            <button key={s} type="button" onClick={() => toggleSource(s)}
              title={hidden.has(s) ? 'Einblenden' : 'Ausblenden'}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-opacity ${sourceTone(s, isDark)} ${hidden.has(s) ? 'opacity-30 line-through' : ''}`}>
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {entries === undefined && <p className={`flex items-center gap-1.5 text-[11px] ${c.muted}`}><Loader2 size={11} className="animate-spin" /> Lade Verlauf …</p>}
        {entries === null && <p className={`text-[11px] ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>Das Protokoll ist nicht lesbar.</p>}
        {entries && !shown.length && (
          <p className={`text-[11px] ${c.muted}`}>
            {entries.length ? 'Keine Änderungen für diese Auswahl.' : 'Noch keine Änderungen protokolliert — das Protokoll beginnt mit der nächsten Änderung.'}
          </p>
        )}
        {!!entries?.length && filtered && (
          <button type="button" onClick={() => { setQuery(''); setWho(''); setRange('all'); setFrom(''); setTo(''); setHidden(new Set()); p.onFocus(null); }}
            className={`text-[10px] underline ${c.muted}`}>Alle Filter zurücksetzen</button>
        )}
        {shown.map(e => (
          <div key={e.id} className={`rounded border ${c.border} px-2.5 py-2 space-y-1`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`text-[10px] tabular-nums flex-shrink-0 ${c.muted2}`} title={whenFull(e.at)}>{whenLabel(e.at)}</span>
              <span className={`text-[11px] font-semibold truncate ${c.text}`} title={e.email ?? e.author}>{e.author}</span>
              <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 ${sourceTone(e.source, isDark)}`}>{SOURCE_LABEL[e.source]}</span>
            </div>
            {e.note && <p className={`text-[10px] italic ${c.muted2}`}>{e.note}</p>}
            {e.report && !focus && !query.trim() && (
              <div className={`text-[10px] ${c.muted}`}>
                {Object.entries(e.report).map(([k, v]) => (
                  <div key={k} className="truncate" title={v.join('\n')}><span className={c.muted2}>{k}:</span> {v.join(', ')}</div>
                ))}
              </div>
            )}
            <ul className="space-y-0.5">
              {e.changes.map((ch, i) => <ChangeLine key={i} ch={ch} isDark={isDark} exists={current.has(ch.target) || current.has(auditBase(ch.target))} onGoto={p.onGoto} />)}
            </ul>
            {!!e.more && !focus && !query.trim() && <p className={`text-[10px] ${c.muted}`}>… und {e.more} weitere Änderungen</p>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function ChangeLine({ ch, isDark, exists, onGoto }: { ch: AuditChange; isDark: boolean; exists: boolean; onGoto: (t: string) => void }) {
  const c = cls(isDark);
  const sign = ch.op === 'add' ? '+' : ch.op === 'remove' ? '−' : '~';
  const tone = ch.op === 'add' ? (isDark ? 'text-emerald-400' : 'text-emerald-700')
    : ch.op === 'remove' ? (isDark ? 'text-rose-400' : 'text-rose-600')
      : (isDark ? 'text-amber-300' : 'text-amber-700');
  const del = isDark ? 'text-rose-300/80 line-through' : 'text-rose-700/80 line-through';
  const ins = isDark ? 'text-emerald-300' : 'text-emerald-800';
  return (
    <li className="text-[10px] leading-snug">
      <span className={`font-mono mr-1 ${tone}`}>{sign}</span>
      <button type="button" disabled={!exists} onClick={() => onGoto(ch.target)}
        title={exists ? 'Zur Stelle' : 'Diese Stelle gibt es nicht mehr'}
        className={`${c.text} ${exists ? 'hover:underline' : 'opacity-60 cursor-default'}`}>{ch.label}</button>
      {ch.field && <span className={c.muted2}> · {ch.field}</span>}
      {(ch.before !== undefined || ch.after !== undefined) && (
        <div className="pl-3 break-words">
          {ch.op === 'change' ? <>
            <span className={ch.before === undefined ? c.muted : del}>{ch.before ?? 'leer'}</span>
            <span className={c.muted}> → </span>
            <span className={ch.after === undefined ? c.muted : ins}>{ch.after ?? 'leer'}</span>
          </> : <span className={c.muted2}>{ch.after ?? ch.before}</span>}
        </div>
      )}
    </li>
  );
}
