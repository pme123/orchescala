// «Daten» im Designer: was im Zustand einer Seite steht - woher es kommt, mit seinen Feldern und Typen -
// und die Services, die eine Seite aufrufen kann, mit ihrem In und Out. Ein Klick auf einen Pfad kopiert
// ihn als {{pfad}} - für Texte, Listen und Bedingungen.
import { ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';
import { cls } from '../../ui';
import type { DataNode, PField, Targets } from './model';

/** Der Typ eines Felds, wie man ihn in Scala liest: `Seq[Slot]`, `Option[String]`. */
function typeText(f: Pick<PField, 'type' | 'collection' | 'optional'>): string {
  const base = f.collection ? `Seq[${f.type}]` : f.type;
  return f.optional ? `Option[${base}]` : base;
}

export function DataView({ isDark, nodes, targets, usedServices, onSelect }: {
  isDark: boolean; nodes: DataNode[]; targets: Targets; usedServices: string[]; onSelect: (key: string) => void;
}) {
  const c = cls(isDark);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (path: string) => {
    void navigator.clipboard?.writeText(`{{${path}}}`).catch(() => {});
    setCopied(path);
    setTimeout(() => setCopied((p) => (p === path ? null : p)), 1200);
  };

  /** Ein Pfad zum Kopieren - in einer Liste mit `.0` für den ersten Eintrag; in einer Liste sind die Felder
    * eines Eintrags direkt erreichbar ({{start}} im Eintrag einer «Auswahl aus Liste»). */
  const Path = ({ path, label }: { path: string; label: string }) => (
    <button type="button" onClick={() => copy(path)} title={`{{${path}}} kopieren`}
      className={`group inline-flex items-center gap-1 font-mono text-[10.5px] ${c.text} hover:text-sky-500`}>
      {label}
      <Copy size={9} className="opacity-0 group-hover:opacity-60" />
      {copied === path && <span className="text-[9px] text-emerald-500 font-sans">kopiert</span>}
    </button>
  );

  // die Felder - im Zustand zum Kopieren, bei einem Service nur zum Lesen (dort gibt es keinen Pfad)
  const Fields = ({ prefix, fields, depth, copyable = true }: { prefix: string; fields: PField[]; depth: number; copyable?: boolean }) => (
    <div className={`border-l pl-2 ml-1 space-y-0.5 ${c.border}`}>
      {fields.map((f) => {
        const path = `${prefix}.${f.name}`;
        return (
          <div key={f.name}>
            <div className="flex items-baseline gap-1.5">
              {copyable ? <Path path={path} label={f.name} /> : <span className={`font-mono text-[10.5px] ${c.text}`}>{f.name}</span>}
              <span className={`text-[9.5px] font-mono ${c.muted}`} title={f.values?.join(', ')}>
                {typeText(f)}{f.values?.length ? ` (${f.values.slice(0, 4).join(' | ')}${f.values.length > 4 ? ' …' : ''})` : ''}
              </span>
            </div>
            {f.fields && depth < 3 && (
              <>
                {f.collection && <div className={`text-[9px] ${c.muted}`}>je Eintrag:</div>}
                <Fields prefix={f.collection ? `${path}.0` : path} fields={f.fields} depth={depth + 1} copyable={copyable} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="px-3 py-2 space-y-4">
      <section className="space-y-2">
        <div className={`text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>Zustand der Seite</div>
        <p className={`text-[9.5px] leading-snug ${c.muted}`}>
          Was Texte, Listen und Bedingungen lesen können. Ein Klick kopiert den Pfad als {'{{pfad}}'}.
        </p>
        {nodes.map((n) => (
          <div key={n.path} className={`rounded border px-2 py-1.5 space-y-1 ${c.border2}`}>
            <div className="flex items-baseline gap-1.5">
              <Path path={n.path} label={n.path} />
              {n.type && <span className={`text-[9.5px] font-mono ${c.muted}`}>{n.type}</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {n.sources.map((s) => (
                <button key={s} type="button" disabled={n.key === undefined} onClick={() => n.key !== undefined && onSelect(n.key)}
                  className={`text-[9px] px-1.5 py-0.5 rounded border ${c.border} ${c.muted2} ${n.key !== undefined ? 'hover:text-sky-500' : ''}`}>
                  {s}
                </button>
              ))}
            </div>
            {n.values && <div className={`text-[9.5px] font-mono ${c.muted}`}>Werte: {n.values.join(' | ')}</div>}
            {n.fields && n.fields.length > 0 && <Fields prefix={n.path} fields={n.fields} depth={0} />}
          </div>
        ))}
      </section>

      <section className="space-y-1.5">
        <div className={`text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>Services</div>
        <p className={`text-[9.5px] leading-snug ${c.muted}`}>
          Aus dem Katalog der Domain - eine Aktion «Service aufrufen» legt das Out unter «Ergebnis nach» ab.
        </p>
        {targets.services.length === 0 && <p className={`text-[10px] ${c.muted}`}>Keine Services im Katalog.</p>}
        {targets.services.map((s) => (
          <details key={s.topic} className={`rounded border ${c.border2}`} open={usedServices.includes(s.topic)}>
            <summary className={`flex items-center gap-1 px-2 py-1 cursor-pointer list-none text-[10.5px] ${c.text}`}>
              <ChevronRight size={10} className={c.muted} />
              <span className="font-mono truncate">{s.topic}</span>
              {usedServices.includes(s.topic) && <span className="ml-auto text-[9px] text-sky-500">auf dieser Seite</span>}
            </summary>
            <div className="px-2 pb-2 space-y-1.5">
              {s.descr && <p className={`text-[9.5px] ${c.muted}`}>{s.descr}</p>}
              <div>
                <div className={`text-[9px] uppercase tracking-widest ${c.muted}`}>In</div>
                {s.in.length ? <Fields prefix="" fields={s.in} depth={0} copyable={false} /> : <div className={`text-[9.5px] ${c.muted}`}>keine Felder</div>}
              </div>
              <div>
                <div className={`text-[9px] uppercase tracking-widest ${c.muted}`}>Out</div>
                {s.out.length ? <Fields prefix="" fields={s.out} depth={0} copyable={false} /> : <div className={`text-[9.5px] ${c.muted}`}>keine Felder</div>}
              </div>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
