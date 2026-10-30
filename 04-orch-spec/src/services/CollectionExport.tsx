// Export of a service collection: the Scala code to check and copy, and the
// command for the project — `./helper.scala processFromSpec orchspec:…` with
// `{ v: 2, kind: 'serviceCollection', scala }`. Version 2, so that an older
// helper refuses it instead of taking the services for a process.
import { AlertTriangle, Check, Copy, Download, Terminal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { helperCommandOf } from '../exporters';
import type { Model } from '../types';
import { cls } from '../ui';
import { collectionSlug } from './collection';
import { collectionBundle, openTodos } from './scalaCollection';
import type { ServiceCollectionSpec } from './types';

export const collectionHelperCommand = (spec: ServiceCollectionSpec, model: Model | null): string =>
  helperCommandOf(JSON.stringify({ v: 2, kind: 'serviceCollection', scala: collectionBundle(spec, model) }));

export default function CollectionExport({ spec, model, isDark, onClose }: {
  spec: ServiceCollectionSpec; model: Model | null; isDark: boolean; onClose: () => void;
}) {
  const c = cls(isDark);
  const text = useMemo(() => collectionBundle(spec, model), [spec, model]);
  const todos = useMemo(() => openTodos(spec, model), [spec, model]);
  const [copied, setCopied] = useState<'scala' | number | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const fileName = `${collectionSlug(spec)}.scala`;

  const flash = (what: 'scala' | number) => { setCopied(what); setTimeout(() => setCopied(null), 2500); };
  const copyCommand = async () => {
    const command = collectionHelperCommand(spec, model);
    try { await navigator.clipboard.writeText(command); setShown(null); flash(Math.ceil(command.length / 1024)); }
    catch { setShown(command); }
  };
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className={`max-w-5xl w-full max-h-[85vh] flex flex-col rounded-xl border p-5 ${c.border2} ${c.panelStrong}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h3 className={`text-sm font-semibold ${c.text}`}>Export — {spec.title}</h3>
          <button onClick={onClose} className={`p-1 ${c.muted}`}><X size={14} /></button>
        </div>
        <p className={`text-[10px] mb-2 ${c.muted}`}>
          Je Service ein ServiceTask in <span className="font-mono">01-domain</span> und ein ServiceWorker in <span className="font-mono">03-worker</span>,
          dazu der Super-Trait und die Typen der API. Der Helper legt an, was fehlt, vergleicht Bestehendes (überschreibt nie) und
          registriert die Worker in der WorkerApp und die Services in der API-Doku.
        </p>
        {todos.length > 0 && (
          <div className={`mb-2 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
            <div className="flex items-center gap-1 font-semibold"><AlertTriangle size={11} /> Von Hand zu ergänzen (<span className="font-mono">???</span>)</div>
            {todos.map(t => <div key={t.file}><span className="font-mono">{t.file}</span> · {t.count}×</div>)}
          </div>
        )}
        {shown !== null && (
          <div className={`mb-2 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
            Der Browser lässt das Kopieren nicht zu — den Befehl unten markieren, kopieren und im Projektordner ins Terminal einfügen.
          </div>
        )}
        <textarea readOnly value={shown ?? text} onFocus={e => { if (shown !== null) e.currentTarget.select(); }}
          className={`flex-1 min-h-[16rem] text-[10px] leading-relaxed font-mono px-3 py-2 rounded border outline-none resize-none ${c.input}`} />
        <div className="flex items-center gap-2 pt-3">
          <span className={`min-w-0 truncate text-[10px] ${c.muted}`}>{(shown ?? text).length.toLocaleString('de-CH')} Zeichen · {shown !== null ? 'Befehl für ./helper.scala' : fileName}</span>
          <button onClick={copyCommand}
            title={'Befehl für das Service-Projekt: ./helper.scala processFromSpec orchspec:…\nIm Projektordner ins Terminal einfügen und Enter drücken.'}
            className={`ml-auto shrink-0 whitespace-nowrap flex items-center gap-1.5 text-xs px-3 py-2 rounded border ${c.btn}`}>
            {typeof copied === 'number' ? <><Check size={12} /> Befehl kopiert ({copied} KB)</> : <><Terminal size={12} /> Services from Spec</>}
          </button>
          <button onClick={async () => { await navigator.clipboard.writeText(text); flash('scala'); }}
            className={`shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded border ${c.btn}`}>
            {copied === 'scala' ? <><Check size={12} /> Kopiert</> : <><Copy size={12} /> Kopieren</>}
          </button>
          <button onClick={save} className={`shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-transparent ${c.btnPrimary}`}>
            <Download size={12} /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
