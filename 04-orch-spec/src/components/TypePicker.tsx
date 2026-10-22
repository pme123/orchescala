// Searchable type picker for a field.
//
// Order of the groups, from near to far: first the **simple types**,
// then the **own types** of the process, the **types of Orchescala**
// (`ProcessStatus` — belongs to the patterns, always there), then the
// **service objects** from the catalog. Typing filters across everything, name matches first; Enter takes
// the first match.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Braces, ChevronDown, Code, ListOrdered, Plug, Search, Type as TypeIcon, X } from 'lucide-react';
import { SCALA_TYPES, type Model, type TypeDef } from '../types';
import { domainRef, serviceTypes, type ServiceType } from '../serviceTypes';
import { cls } from '../ui';
import { isScalaTypeExpression } from '../scala';
import { ORCHESCALA_TYPES } from '../orchescalaTypes';

export const NEW_CASE = '__newCase';
export const NEW_ENUM = '__newEnum';

interface Entry {
  value: string;
  /** Scala name */
  name: string;
  /** Extra info on the right (package, kind, service) */
  hint?: string;
  group: 'einfach' | 'eigene' | 'orchescala' | 'service';
  icon: typeof Braces;
  warn?: boolean;
  /** what is searched */
  haystack: string;
}

const GROUP_LABEL: Record<Entry['group'], string> = {
  einfach: 'Einfache Typen',
  eigene: 'Eigene Typen',
  orchescala: 'Orchescala',
  service: 'Service-Objekte',
};

export default function TypePicker({ value, types, selfId, model, isDark, disabled, onPick, onCreate, className }: {
  value: string;
  types: TypeDef[];
  /** own type — do not reference itself */
  selfId: string;
  model: Model | null;
  isDark: boolean;
  disabled?: boolean;
  onPick: (value: string) => void;
  onCreate: (kind: 'case' | 'enum') => void;
  /** Width in the surrounding layout, e.g. `flex-1` */
  className?: string;
}) {
  const c = cls(isDark);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Group 3 = everything that comes from outside. The loaded domain catalog is
  // exact; the types derived from the service name only step in where the
  // catalog does not know the service (yet).
  const domain = model?.domainTypes ?? [];
  const svc = useMemo(() => {
    const known = new Set(domain.map(d => d.name));
    return serviceTypes(model).filter(s => !known.has(s.name));
  }, [model, domain]);

  const entries = useMemo<Entry[]>(() => [
    ...SCALA_TYPES.map(t => ({
      value: t, name: t, group: 'einfach' as const, icon: TypeIcon, haystack: t.toLowerCase(),
    })),
    ...types
      .filter(t => t.id !== selfId && !t.root && !t.inConfig)
      .map(t => ({
        value: t.id,
        name: t.name,
        hint: t.kind === 'enum' ? 'Auswahl' : 'Klasse',
        group: 'eigene' as const,
        icon: t.kind === 'enum' ? ListOrdered : Braces,
        haystack: `${t.name} ${t.description ?? ''}`.toLowerCase(),
      })),
    // from `orchescala.domain` — there without catalog and without search
    ...ORCHESCALA_TYPES.map(d => ({
      value: domainRef(d.id),
      name: d.name,
      hint: d.pkg,
      group: 'orchescala' as const,
      icon: d.kind === 'enum' ? ListOrdered : Braces,
      haystack: `${d.name} ${d.pkg} ${(d.values ?? []).join(' ')}`.toLowerCase(),
    })),
    // `InConfig` and `InitIn` are in the catalog (for the reconciliation), but are
    // implementation details — they have no place as a field type.
    ...domain.filter(d => !/\.(InConfig|InitIn)$/.test(d.name) && !ORCHESCALA_TYPES.some(o => o.id === d.id)).map(d => ({
      value: domainRef(d.id),
      name: d.name,
      hint: d.pkg,
      group: 'service' as const,
      icon: Plug,
      haystack: `${d.name} ${d.pkg} ${(d.fields ?? []).map(f => f.name).join(' ')} ${(d.values ?? []).join(' ')}`.toLowerCase(),
    })),
    ...svc.map((s: ServiceType) => ({
      value: s.value,
      name: s.name,
      hint: `${s.label} · abgeleitet`,
      group: 'service' as const,
      icon: Plug,
      warn: s.uncertain,
      haystack: `${s.name} ${s.label} ${s.serviceId} ${s.group}`.toLowerCase(),
    })),
  ], [types, selfId, svc, domain]);

  const current = entries.find(e => e.value === value);
  const scalaType = !current && isScalaTypeExpression(value);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      // without search: everything own and simple, services only partially shown
      return [
        ...entries.filter(e => e.group !== 'service'),
        ...entries.filter(e => e.group === 'service').slice(0, 20),
      ];
    }
    const words = needle.split(/\s+/);
    // Whoever matches the name comes before those that only match a field or the package
    // — otherwise `ProcessCallOrigin` stands behind every `In` with a
    // field `processCallOrigin` (and possibly falls behind the limit).
    const rang = (e: Entry) => {
      const n = e.name.toLowerCase(), kurz = n.split('.').pop()!;
      if (n === needle || kurz === needle) return 0;
      if (n.startsWith(needle) || kurz.startsWith(needle)) return 1;
      if (words.every(w => n.includes(w))) return 2;
      return 3;
    };
    return entries
      .filter(e => words.every(w => e.haystack.includes(w)))
      .map((e, i) => ({ e, r: rang(e), i }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(x => x.e)
      .slice(0, 120);
  }, [entries, q]);

  // Clicking outside and Escape close it
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!boxRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (v: string) => { onPick(v); setOpen(false); setQ(''); };

  const groups: Entry['group'][] = ['einfach', 'eigene', 'orchescala', 'service'];
  const truncated = q.trim() && hits.length >= 120;
  const moreServices = !q.trim() && entries.filter(e => e.group === 'service').length > 20;

  return (
    <div className={`relative ${className ?? ''}`} ref={boxRef}>
      <button disabled={disabled}
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 20); }}
        title={current?.hint ? `${current.name} — ${current.hint}`
          : current?.name ?? (scalaType ? `${value} — Scala-Typ aus der Domain, wird wörtlich übernommen` : value)}
        className={`flex items-center gap-1.5 w-full text-[11px] leading-[18px] px-2 py-1 rounded border text-left ${c.border2} ${disabled ? '' : c.hover}`}>
        {current ? <current.icon size={10} className={c.muted} />
          // a Scala type from the domain (`MockedServiceResponse[GetX.Out]`) is not an error
          : scalaType ? <Code size={10} className={c.muted} />
            : <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
        <span className={`flex-1 truncate font-mono ${c.text}`}>{current?.name ?? value}</span>
        {!disabled && <ChevronDown size={11} className={c.muted} />}
      </button>

      {open && (
        <div className={`absolute z-30 mt-1 w-[26rem] rounded border shadow-xl ${c.border2} ${c.panelStrong}`}>
          <div className={`flex items-center gap-1.5 px-2 py-1.5 border-b ${c.border}`}>
            <Search size={11} className={c.muted} />
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                // the topmost entry, as it is displayed (by groups)
                const first = groups.map(g => hits.find(h => h.group === g)).find(Boolean);
                if (e.key === 'Enter' && first) { e.preventDefault(); pick(first.value); }
              }}
              placeholder={`${entries.length} Typen durchsuchen …`}
              className={`flex-1 bg-transparent outline-none text-[11px] ${c.text}`} />
            {q && <button onClick={() => setQ('')} className={c.muted}><X size={11} /></button>}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {groups.map(g => {
              const rows = hits.filter(e => e.group === g);
              if (!rows.length) return null;
              return (
                <div key={g}>
                  <div className={`text-[9px] uppercase tracking-widest px-2 py-1 sticky top-0 ${c.muted} ${c.panelStrong}`}>
                    {GROUP_LABEL[g]}
                  </div>
                  {rows.map(e => (
                    <button key={e.value} onClick={() => pick(e.value)}
                      className={`w-full flex items-center gap-2 px-2 py-1 text-left ${c.hover} ${
                        e.value === value ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                      <e.icon size={10} className={c.muted} />
                      <span className={`font-mono text-[11px] truncate ${c.text}`}>{e.name}</span>
                      {e.warn && (
                        <AlertTriangle size={9} className={isDark ? 'text-amber-400' : 'text-amber-600'}
                          aria-label="Import prüfen" />
                      )}
                      {e.hint && <span className={`ml-auto text-[9px] truncate max-w-[13rem] ${c.muted}`}>{e.hint}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
            {!hits.length && <div className={`px-2 py-3 text-[10px] ${c.muted}`}>Nichts gefunden.</div>}
            {!domain.length && (
              <div className={`flex items-center gap-1.5 px-2 py-1.5 text-[9px] ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                <AlertTriangle size={9} /> Kein Katalog geladen — Service- und Firmentypen fehlen (Admin → Katalog).
              </div>
            )}
            {(truncated || moreServices) && (
              <div className={`px-2 py-1.5 text-[9px] ${c.muted}`}>
                {truncated ? 'Weitere Treffer — Suche verfeinern.' : 'Weitere Service-Objekte über die Suche.'}
              </div>
            )}
          </div>

          <div className={`flex gap-1 px-2 py-1.5 border-t ${c.border}`}>
            <button onClick={() => { onCreate('case'); setOpen(false); setQ(''); }}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
              <Braces size={10} /> neue Klasse
            </button>
            <button onClick={() => { onCreate('enum'); setOpen(false); setQ(''); }}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
              <ListOrdered size={10} /> neue Auswahl
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
