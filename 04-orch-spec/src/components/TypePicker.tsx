// Suchbare Typ-Auswahl für ein Feld.
//
// Reihenfolge der Gruppen, von nah nach fern: erst die **einfachen Typen**,
// dann die **eigenen Typen** des Prozesses, dann die **Service-Objekte** aus
// dem Katalog. Tippen filtert über alles; Enter nimmt den ersten Treffer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Braces, ChevronDown, ListOrdered, Plug, Search, Type as TypeIcon, X } from 'lucide-react';
import { SCALA_TYPES, type Model, type TypeDef } from '../types';
import { domainRef, serviceTypes, type ServiceType } from '../serviceTypes';
import { cls } from '../ui';

export const NEW_CASE = '__newCase';
export const NEW_ENUM = '__newEnum';

interface Entry {
  value: string;
  /** Scala-Name */
  name: string;
  /** Zusatz rechts (Package, Art, Service) */
  hint?: string;
  group: 'einfach' | 'eigene' | 'service';
  icon: typeof Braces;
  warn?: boolean;
  /** worüber gesucht wird */
  haystack: string;
}

const GROUP_LABEL: Record<Entry['group'], string> = {
  einfach: 'Einfache Typen',
  eigene: 'Eigene Typen',
  service: 'Service-Objekte',
};

export default function TypePicker({ value, types, selfId, model, isDark, disabled, onPick, onCreate }: {
  value: string;
  types: TypeDef[];
  /** eigener Typ — nicht auf sich selbst verweisen */
  selfId: string;
  model: Model | null;
  isDark: boolean;
  disabled?: boolean;
  onPick: (value: string) => void;
  onCreate: (kind: 'case' | 'enum') => void;
}) {
  const c = cls(isDark);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Gruppe 3 = alles, was von aussen kommt. Der eingelesene Domain-Katalog ist
  // exakt; die aus dem Servicenamen abgeleiteten Typen springen nur ein, wo der
  // Katalog den Service (noch) nicht kennt.
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
      .filter(t => t.id !== selfId && !t.root)
      .map(t => ({
        value: t.id,
        name: t.name,
        hint: t.kind === 'enum' ? 'Auswahl' : 'Klasse',
        group: 'eigene' as const,
        icon: t.kind === 'enum' ? ListOrdered : Braces,
        haystack: `${t.name} ${t.description ?? ''}`.toLowerCase(),
      })),
    // `InConfig` und `InitIn` stehen im Katalog (für den Abgleich), sind aber
    // Implementations-Details — als Feldtyp haben sie nichts verloren.
    ...domain.filter(d => !/\.(InConfig|InitIn)$/.test(d.name)).map(d => ({
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

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      // ohne Suche: alles Eigene und Einfache, Services nur angeschnitten
      return [
        ...entries.filter(e => e.group !== 'service'),
        ...entries.filter(e => e.group === 'service').slice(0, 20),
      ];
    }
    const words = needle.split(/\s+/);
    return entries.filter(e => words.every(w => e.haystack.includes(w))).slice(0, 120);
  }, [entries, q]);

  // Klick daneben und Escape schliessen
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

  const groups: Entry['group'][] = ['einfach', 'eigene', 'service'];
  const truncated = q.trim() && hits.length >= 120;
  const moreServices = !q.trim() && entries.filter(e => e.group === 'service').length > 20;

  return (
    <div className="relative" ref={boxRef}>
      <button disabled={disabled}
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 20); }}
        title={current?.hint ? `${current.name} — ${current.hint}` : current?.name ?? value}
        className={`flex items-center gap-1.5 w-52 text-[11px] px-2 py-1 rounded border text-left ${c.border2} ${disabled ? '' : c.hover}`}>
        {current ? <current.icon size={10} className={c.muted} /> : <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
        <span className={`flex-1 truncate font-mono ${c.text}`}>{current?.name ?? value}</span>
        {!disabled && <ChevronDown size={11} className={c.muted} />}
      </button>

      {open && (
        <div className={`absolute z-30 mt-1 w-[26rem] rounded border shadow-xl ${c.border2} ${c.panelStrong}`}>
          <div className={`flex items-center gap-1.5 px-2 py-1.5 border-b ${c.border}`}>
            <Search size={11} className={c.muted} />
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && hits[0]) { e.preventDefault(); pick(hits[0].value); }
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
