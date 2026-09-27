// Katalog nachschlagen.
//
// Kein Blättern durch 2000 Zeilen: die Klassen sieht man ohnehin in jeder
// Spezifikation, dort wo sie gebraucht werden. Hier zählt eine einzige Frage
// — **steht das im Katalog?** — und die beantwortet eine Suche über Services
// und Domain-Typen zugleich.
import { useMemo, useState } from 'react';
import { Braces, ChevronDown, ChevronRight, Link2, ListOrdered, Puzzle, Search, X } from 'lucide-react';
import type { DomainType, Model, ServiceDef } from '../types';
import { STEP_ICON, cls } from '../ui';

/** Die Arten im Katalog: Services nach Schrittart, Typen nach Scala-Art. */
export type CatalogKind = 'service' | 'call' | 'user' | 'send' | 'rule' | 'case' | 'enum' | 'member' | 'alias';

const KIND_ORDER: CatalogKind[] = ['service', 'call', 'user', 'send', 'rule', 'case', 'enum', 'member', 'alias'];

const KIND_TEXT: Record<CatalogKind, string> = {
  service: 'Worker', call: 'Prozess', user: 'Benutzeraufgabe', send: 'Signal / Nachricht', rule: 'Entscheidung',
  case: 'Klasse', enum: 'Enum', member: 'aus dem Trait', alias: 'Alias',
};

/** Farbe und Zeichen je Art — Klasse und Enum wie im Datenmodell, Services in Teal wie Katalog-Verweise. */
function kindStyle(kind: CatalogKind, isDark: boolean): { cls: string; icon: React.ReactNode } {
  const ico = (I: typeof Braces) => <I size={9} className="flex-shrink-0" />;
  switch (kind) {
    case 'case': return { icon: ico(Braces), cls: isDark ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-sky-300 bg-sky-50 text-sky-800' };
    case 'enum': return { icon: ico(ListOrdered), cls: isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-800' };
    case 'member': return { icon: ico(Puzzle), cls: isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50' };
    case 'alias': return { icon: ico(Link2), cls: isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50' };
    default: return { icon: ico(STEP_ICON[kind]), cls: isDark ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-teal-300 bg-teal-50 text-teal-800' };
  }
}

/** Art als Chip — mit Zahl in der Zustandszeile, ohne in den Treffern. */
export function KindChip({ kind, isDark, count }: { kind: CatalogKind; isDark: boolean; count?: number }) {
  const st = kindStyle(kind, isDark);
  return (
    <span title={KIND_TEXT[kind]} className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-px rounded border whitespace-nowrap ${st.cls}`}>
      {st.icon}{count != null && <span className="font-semibold">{count}</span>}{KIND_TEXT[kind]}
    </span>
  );
}

const serviceKind = (s: ServiceDef): CatalogKind => {
  const k = s.kind ?? 'service';
  return k === 'call' || k === 'user' || k === 'send' || k === 'rule' ? k : 'service';
};

/** Anzahl je Art, in fester Reihenfolge — nur Arten, die vorkommen. */
export function catalogCounts(model: Model): Array<[CatalogKind, number]> {
  const m = new Map<CatalogKind, number>();
  for (const s of model.services ?? []) m.set(serviceKind(s), (m.get(serviceKind(s)) ?? 0) + 1);
  for (const t of model.domainTypes ?? []) m.set(t.kind, (m.get(t.kind) ?? 0) + 1);
  return KIND_ORDER.filter(k => m.has(k)).map(k => [k, m.get(k)!]);
}

const GRENZE = 40;

export default function CatalogSearch({ model, isDark }: { model: Model; isDark: boolean }) {
  const c = cls(isDark);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const services = useMemo(() => model.services ?? [], [model.services]);
  const types = useMemo(() => model.domainTypes ?? [], [model.domainTypes]);

  const gruppen = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of services) m.set(s.group ?? '—', (m.get(s.group ?? '—') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [services]);

  const worte = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const passt = (heu: string) => worte.every(w => heu.toLowerCase().includes(w));

  const treffer = useMemo(() => {
    if (!worte.length) return { services: [] as ServiceDef[], types: [] as DomainType[], mehr: 0 };
    const s = services.filter(x => passt(`${x.id} ${x.name} ${x.group ?? ''} ${x.description ?? ''} ${x.topic ?? ''}`));
    const t = types.filter(x => passt(
      `${x.name} ${x.pkg} ${(x.fields ?? []).map(f => `${f.name} ${f.type}`).join(' ')} ${(x.values ?? []).join(' ')}`));
    return {
      services: s.slice(0, GRENZE),
      types: t.slice(0, GRENZE),
      mehr: Math.max(0, s.length - GRENZE) + Math.max(0, t.length - GRENZE),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, types, q]);

  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider mb-1 ${c.text}`}>Nachschlagen</div>
      <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded border mb-2 ${c.border2}`}>
        <Search size={11} className={c.muted} />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Service, Topic, Klasse, Paket, Feld …"
          className={`flex-1 bg-transparent outline-none text-[11px] ${c.text}`} />
        {q && <button onClick={() => setQ('')} className={c.muted}><X size={11} /></button>}
      </div>

      {!worte.length ? (
        <div className={`rounded border px-3 py-2 text-[10px] ${c.border2} ${c.muted}`}>
          {services.length} Services in {gruppen.length} Gruppen · {types.length} Domain-Typen.
          {gruppen.length > 0 && (
            <span> Grösste Gruppen: {gruppen.slice(0, 5).map(([g, n]) => `${g} (${n})`).join(' · ')}.</span>
          )}
          {' '}Steht das drin? Die Klassen eines Prozesses stehen ohnehin in seiner Spezifikation unter <b>Datenmodell</b>.
        </div>
      ) : !treffer.services.length && !treffer.types.length ? (
        <div className={`rounded border px-3 py-2 text-[10px] ${c.border2} ${c.muted}`}>
          Nichts gefunden — weder unter den Services noch unter den Domain-Typen.
        </div>
      ) : (
        <div className={`rounded border divide-y ${c.border2} ${isDark ? 'divide-white/8' : 'divide-black/8'}`}>
          {treffer.services.map(s => (
            <div key={s.id}>
              <button onClick={() => setOpen(open === s.id ? null : s.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${c.hover}`}>
                {open === s.id ? <ChevronDown size={11} className={c.muted} /> : <ChevronRight size={11} className={c.muted} />}
                <KindChip kind={serviceKind(s)} isDark={isDark} />
                <span className={`text-[11px] truncate ${c.text}`}>{s.name}</span>
                <span className={`text-[9px] font-mono truncate ${c.muted}`}>{s.id}</span>
                <span className={`ml-auto text-[9px] flex-shrink-0 ${c.muted}`}>
                  {(s.inputs?.length ?? 0)} in · {(s.outputs?.length ?? 0)} out
                </span>
              </button>
              {open === s.id && (
                <div className={`px-3 pb-2 pl-8 text-[10px] space-y-1 ${c.muted2}`}>
                  {s.description && <p className="whitespace-pre-wrap">{s.description}</p>}
                  {s.topic && <div>Topic: <span className="font-mono">{s.topic}</span></div>}
                  {!!s.inputs?.length && (
                    <div>
                      <div className={`uppercase tracking-wider ${c.muted}`}>Eingaben</div>
                      {s.inputs.map(i => <div key={i.name} className="font-mono">{i.name}</div>)}
                    </div>
                  )}
                  {!!s.outputs?.length && (
                    <div>
                      <div className={`uppercase tracking-wider ${c.muted}`}>Ausgaben</div>
                      {s.outputs.map(o => <div key={o.name} className="font-mono">{o.name}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {treffer.types.map(t => (
            <div key={t.id}>
              <button onClick={() => setOpen(open === t.id ? null : t.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${c.hover}`}>
                {open === t.id ? <ChevronDown size={11} className={c.muted} /> : <ChevronRight size={11} className={c.muted} />}
                <KindChip kind={t.kind} isDark={isDark} />
                <span className={`font-mono text-[11px] truncate ${c.text}`}>{t.name}</span>
                {t.dsl && <span className={`text-[9px] ${c.muted}`}>{t.dsl.replace(/^CompanyBpmn|Dsl$/g, '')}</span>}
                <span className={`ml-auto text-[9px] font-mono truncate max-w-[22rem] ${c.muted}`}>{t.pkg}</span>
              </button>
              {open === t.id && (
                <div className={`px-3 pb-2 pl-8 text-[10px] space-y-1 ${c.muted2}`}>
                  {t.descr && <p>{t.descr}</p>}
                  <div className="font-mono">import {t.importPath}</div>
                  {!!t.fields?.length && (
                    <div>
                      <div className={`uppercase tracking-wider ${c.muted}`}>Felder</div>
                      {t.fields.map(f => (
                        <div key={f.name} className="font-mono">
                          {f.name}: {f.type}{f.default ? ` = ${f.default}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {!!t.values?.length && <div>Werte: <span className="font-mono">{t.values.join(', ')}</span></div>}
                </div>
              )}
            </div>
          ))}
          {treffer.mehr > 0 && (
            <div className={`px-3 py-2 text-[10px] ${c.muted}`}>… und {treffer.mehr} weitere — Suche verfeinern</div>
          )}
        </div>
      )}
    </div>
  );
}
