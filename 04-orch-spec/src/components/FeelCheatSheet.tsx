// FEEL-Spickzettel als Dialog (Kopfzeile). Die Beispiele sind eingefärbt wie im
// Eingabefeld: Variablen blau, Zeichenketten grün, FEEL violett. Die Suche
// filtert Beispiele und Funktionen; ein Klick auf ein Beispiel kopiert es.
import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { CHEAT_SECTIONS, JUEL_TO_FEEL } from '../feelCheatSheet';
import { FEEL_DOCS } from '../feelDocs';
import { tokenizeFeel, type FeelTokenKind } from '../feel';
import { cls } from '../ui';

import { C7_LABEL } from '../template';
/** `code` und **fett** in einem Hinweistext */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, i) =>
        p.startsWith('`') ? <code key={i} className="font-mono text-[10px]">{p.slice(1, -1)}</code>
          : p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>)}
    </>
  );
}

export default function FeelCheatSheet({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const c = cls(isDark);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const match = (...t: string[]) => !q || t.some(x => x.toLowerCase().includes(q));

  const tone: Record<FeelTokenKind, string> = {
    variable: isDark ? 'text-blue-300' : 'text-blue-800',
    string: isDark ? 'text-green-400' : 'text-green-700',
    feel: isDark ? 'text-purple-300' : 'text-purple-800',
    comment: c.muted,
    plain: '',
  };
  // Namen im Beispiel, die keine Funktionen sind, gelten als Variablen
  const code = (text: string) => {
    const names = [...new Set(text.match(/(?<![\w.`"])[A-Za-z_]\w*(?!\w*\s*\()/g) ?? [])]
      .filter(n => !FEEL_DOCS.some(d => d.name.split(' ').includes(n)) && !['item', 'true', 'false', 'null'].includes(n));
    return tokenizeFeel(text, names.map(name => ({ name, type: 'any', label: '', source: '' })))
      .map((t, i) => <span key={i} className={tone[t.kind]}>{t.text}</span>);
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(`= ${text}`).then(() => { setCopied(text); setTimeout(() => setCopied(null), 1200); }, () => undefined);
  };

  const sections = useMemo(() => CHEAT_SECTIONS.map(s => ({
    ...s,
    rows: s.rows.filter(r => match(r.code, r.note, s.title)),
    showWarn: !!s.warn && (match(s.warn, s.title)),
  })).filter(s => s.rows.length || (s.showWarn && s.warn)), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const docs = FEEL_DOCS.filter(d => d.kind === 'function' && q && match(d.name, d.description, d.category));
  const juel = JUEL_TO_FEEL.filter(([a, b]) => match(a, b, 'camunda 7 juel'));

  const rowCls = `grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 py-1 border-b last:border-0 ${c.border2}`;
  const th = `text-[11px] font-semibold mt-4 mb-1 ${c.text}`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className={`max-w-4xl w-full max-h-[88vh] flex flex-col rounded-xl border ${c.border2} ${c.panelStrong}`}
        onClick={e => e.stopPropagation()}>
        <div className={`flex items-center gap-3 px-5 pt-4 pb-3 border-b ${c.border2}`}>
          <h3 className={`text-sm font-semibold flex-shrink-0 ${c.text}`}>FEEL-Spickzettel <span className={`text-[10px] font-normal ${c.muted}`}>Camunda 8</span></h3>
          <div className={`flex items-center gap-1.5 flex-1 px-2 py-1 rounded border ${c.border2}`}>
            <Search size={12} className={c.muted} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Suchen: Funktion, Stichwort …"
              className={`flex-1 text-[11px] bg-transparent outline-none ${c.text}`} />
          </div>
          <button onClick={onClose} className={`p-1 ${c.muted}`}><X size={14} /></button>
        </div>

        <div className="overflow-y-auto px-5 pb-5 text-[11px]">
          <p className={`mt-3 leading-relaxed ${c.muted}`}>
            Ein Feld mit <code className="font-mono">=</code> am Anfang ist ein FEEL-Ausdruck. Ein Klick auf ein Beispiel kopiert es (mit «=»).
            Farben wie im Eingabefeld: <span className={tone.variable}>Variablen</span>, <span className={tone.string}>"Zeichenketten"</span>, <span className={tone.feel}>FEEL</span>.
          </p>

          {sections.map(s => (
            <section key={s.title}>
              <h4 className={th}>{s.title}</h4>
              {s.intro && <p className={`mb-1 ${c.muted}`}>{s.intro}</p>}
              {s.rows.map(r => (
                <div key={r.code} className={rowCls}>
                  <button type="button" onClick={() => copy(r.code)} title="Kopieren"
                    className="text-left font-mono text-[10px] whitespace-pre-wrap break-words">
                    {copied === r.code && <Check size={10} className="inline mr-1 text-emerald-500" />}{code(r.code)}
                  </button>
                  <span className={c.muted}><Rich text={r.note} /></span>
                </div>
              ))}
              {s.warn && s.showWarn && (
                <div className={`mt-1.5 px-2 py-1.5 rounded border leading-relaxed whitespace-pre-line ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
                  <Rich text={s.warn.split('\n').map(l => (s.rows.length ? l : `• ${l}`)).join('\n')} />
                </div>
              )}
            </section>
          ))}

          {!!juel.length && (
            <section>
              <h4 className={th}>{C7_LABEL} (JUEL) → Camunda 8 (FEEL)</h4>
              {juel.map(([a, b]) => (
                <div key={a} className={rowCls}>
                  <span className="font-mono text-[10px]">{a}</span>
                  <button type="button" onClick={() => copy(b.replace(/^=\s*/, ''))} title="Kopieren" className="text-left font-mono text-[10px]">
                    {code(b.replace(/^=\s*/, '')).length ? <><span className={c.muted}>= </span>{code(b.replace(/^=\s*/, ''))}</> : b}
                  </button>
                </div>
              ))}
            </section>
          )}

          {!!docs.length && (
            <section>
              <h4 className={th}>Funktionen</h4>
              {docs.map(d => (
                <div key={d.name} className={rowCls}>
                  <span className={`font-mono text-[10px] ${tone.feel}`}>{d.signature}</span>
                  <span className={c.muted}>{d.description}{d.example ? <> <span className="font-mono">z. B. {d.example}</span></> : null}</span>
                </div>
              ))}
            </section>
          )}

          {q && !sections.length && !docs.length && !juel.length && <p className={`mt-4 ${c.muted}`}>Nichts gefunden für «{query}».</p>}

          <p className={`mt-4 ${c.muted}`}>
            Vollständige Referenz: <a className="underline" href="https://docs.camunda.io/docs/components/modeler/feel/what-is-feel/" target="_blank" rel="noopener noreferrer">docs.camunda.io — FEEL</a>
          </p>
        </div>
      </div>
    </div>
  );
}
