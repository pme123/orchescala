// The cases of a mapping: an Out that is an enum with cases (ADT, `ClientRead`) becomes the case
// the case of a source of the In decides (`neoClient: Client`) - per case of the source the case of
// the Out. In the worker a match on the source that calls a method per case, each with its test.
import { ArrowRight, GitFork, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import { indexTypes } from '../scala';
import { adtCases, prefilledAdtCases } from '../typeMappers';
import type { CaseLink, FieldMapping, Model, TypeDef } from '../types';
import { cls } from '../ui';

export default function MappingCases({ mapping, types, model, isDark, canEdit, onChange }: {
  mapping: FieldMapping;
  types: TypeDef[];
  model: Model | null;
  isDark: boolean;
  canEdit: boolean;
  onChange: (m: FieldMapping) => void;
}) {
  const c = cls(isDark);
  const idx = useMemo(() => indexTypes(types, model), [types, model]);
  const name = (ref: string) => idx.nameOf(ref).replace(/^.*\./, '');
  const adts = mapping.out.filter(f => f.name.trim() && !f.collection && adtCases(f.type, idx));
  if (!adts.length) return null;
  const sources = mapping.in.filter(f => f.name.trim() && !f.collection && adtCases(f.type, idx));
  const set = (field: string, link: CaseLink | null) => {
    const rest = (mapping.caseLinks ?? []).filter(x => x.field !== field);
    onChange({ ...mapping, caseLinks: link ? [...rest, link] : rest });
  };
  const select = `text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`;
  const amber = isDark ? 'border-amber-500/60' : 'border-amber-400';

  return (
    <div className="space-y-2">
      {adts.map(f => {
        const field = f.name.trim();
        const targets = adtCases(f.type, idx) ?? [];
        const link = (mapping.caseLinks ?? []).find(x => x.field === field);
        const source = sources.find(s => s.name.trim() === link?.from);
        const from = source ? adtCases(source.type, idx) ?? [] : [];
        // a source chosen: the cases prefilled - names alike, otherwise in their order
        const pick = (src: string) => {
          const s = sources.find(x => x.name.trim() === src);
          set(field, s ? { field, from: src, cases: prefilledAdtCases(adtCases(s.type, idx) ?? [], targets, link?.from === src ? link.cases : []) } : null);
        };
        const setCase = (x: string, to: string) =>
          link && set(field, { ...link, cases: [...link.cases.filter(y => y.from !== x), { from: x, to }] });
        return (
          <div key={f.id} className={`rounded border px-2 py-1.5 space-y-1 text-[10px] ${link && source ? c.border2 : amber}`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="flex items-center gap-1 font-semibold"><GitFork size={10} /> Fälle</span>
              <span className="font-mono">{field}: {name(f.type)}</span>
              <span className={c.muted}>wird je nach Fall von</span>
              <select value={link?.from ?? ''} disabled={!canEdit} onChange={e => pick(e.target.value)}
                className={`${select} ${link && source ? '' : amber}`}>
                <option value="">- Quelle wählen -</option>
                {sources.map(s => <option key={s.id} value={s.name.trim()}>{s.name.trim()}: {name(s.type)}</option>)}
              </select>
              {!sources.length && <span className={c.muted}>- das In hat kein Enum mit Fällen</span>}
              {/* the one source there is: one click */}
              {canEdit && !link && sources.length === 1 && (
                <button type="button" onClick={() => pick(sources[0].name.trim())} className={`px-1.5 py-0.5 rounded ${c.btnPrimary}`}>
                  Fälle von {sources[0].name.trim()} zuordnen
                </button>
              )}
            </div>
            {link && source && (
              <div className="space-y-0.5 pl-2">
                {from.map(x => {
                  const to = link.cases.find(y => y.from === x)?.to ?? '';
                  return (
                    <div key={x} className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)] gap-2 items-center">
                      <span className="font-mono break-all">{name(source.type)}.{x}</span>
                      <ArrowRight size={10} className={c.muted} />
                      <select value={to} disabled={!canEdit} onChange={e => setCase(x, e.target.value)} className={`min-w-0 ${select} ${to ? '' : amber}`}>
                        <option value="">- keiner (Fehler zur Laufzeit) -</option>
                        {targets.map(t => <option key={t} value={t}>{name(f.type)}.{t}</option>)}
                      </select>
                    </div>
                  );
                })}
                {canEdit && (
                  <button type="button" onClick={() => set(field, { ...link, cases: prefilledAdtCases(from, targets, link.cases.filter(y => y.to)) })}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${c.btn}`} title="Die Fälle ohne Ziel vorbelegen: gleicher Name, sonst der einzige, auf den der Name endet - sonst in ihrer Reihenfolge">
                    <Wand2 size={10} /> Vorbelegen
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
