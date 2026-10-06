// Export-Dialog: Zielgruppe wählen, Ergebnis prüfen, kopieren oder speichern.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Terminal, X } from 'lucide-react';
import { EXPORT_META, exportBpmnFor, exportFileName, exportSpec, helperCommand, type ExportKind, type HelperDmn } from '../exporters';
import { useStore } from '../store';
import { ENGINES } from '../template';
import type { EngineId, Model, ProcessSpec } from '../types';
import { cls } from '../ui';

const KINDS: ExportKind[] = ['fachlich', 'orchescala', 'scala', 'bpmn', 'json'];

export default function ExportDialog({ spec, model, bpmn, isDark, onClose }: {
  spec: ProcessSpec; model: Model | null; bpmn?: string; isDark: boolean; onClose: () => void;
}) {
  const c = cls(isDark);
  const { loadDmn } = useStore();
  const [kind, setKind] = useState<ExportKind>('orchescala');
  // die Tabellen der DMN Decisions — vorab geladen, damit das Kopieren im Klick bleibt
  const [dmns, setDmns] = useState<HelperDmn[]>([]);
  useEffect(() => {
    let alive = true;
    const own = (spec.interactions ?? []).filter(i => i.kind === 'decision' && i.dmnFile && i.key);
    void Promise.all(own.map(async i => ({ file: String(i.dmnFile), xml: await loadDmn(spec.slug, i.key) })))
      .then(list => { if (alive) setDmns(list.filter((d): d is HelperDmn => !!d.xml)); });
    return () => { alive = false; };
  }, [spec.interactions, spec.slug, loadDmn]);
  const [copied, setCopied] = useState(false);
  // Grösse des kopierten Helper-Befehls in KB — null, solange nichts kopiert ist
  const [helperCopied, setHelperCopied] = useState<number | null>(null);
  // Zwischenablage gesperrt: der Befehl steht dann im Feld, zum Markieren und Kopieren
  const [helperShown, setHelperShown] = useState<string | null>(null);
  // BPMN für die andere Engine: on the fly umgewandelt, die Spezifikation bleibt, wie sie ist
  const own: EngineId = spec.engine ?? 'c7';
  const [engine, setEngine] = useState<EngineId>(own);
  // samt dem, was beim Schreiben ins BPMN nicht sauber ging (FEEL ohne JUEL-Gegenstück …)
  const bpmnOut = useMemo(
    () => (kind === 'bpmn' && bpmn ? exportBpmnFor(spec, bpmn, engine, model) : null),
    [spec, kind, bpmn, engine, model]);
  const text = useMemo(() => bpmnOut?.xml ?? exportSpec(spec, kind, model, bpmn), [bpmnOut, spec, kind, model, bpmn]);
  const issues = bpmnOut?.issues ?? [];
  const fileName = kind === 'bpmn' && engine !== own
    ? exportFileName(spec, kind).replace(/\.bpmn$/, `-${engine}.bpmn`)
    : exportFileName(spec, kind);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // restriktive Umgebung: Text ist im Feld markierbar
    }
  };

  // BPMN und Scala-Klassen in einem Befehl — `./helper.scala processFromSpec orchspec:…`
  const copyForHelper = async () => {
    // das BPMN für die Engine, die im BPMN-Reiter gewählt ist
    const command = helperCommand(spec, model, bpmn, engine, dmns);
    try {
      await navigator.clipboard.writeText(command);
      setHelperShown(null);
      setHelperCopied(Math.ceil(command.length / 1024));
      setTimeout(() => setHelperCopied(null), 2500);
    } catch {
      setHelperShown(command);
    }
  };

  const save = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className={`max-w-5xl w-full max-h-[85vh] flex flex-col rounded-xl border p-5 ${c.border2} ${c.panelStrong}`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className={`text-sm font-semibold ${c.text}`}>Export — {spec.title}</h3>
          <button onClick={onClose} className={`p-1 ${c.muted}`}><X size={14} /></button>
        </div>

        <div className="flex gap-2 mb-2">
          {KINDS.map(k => (
            <button key={k} onClick={() => { setKind(k); setHelperShown(null); }}
              className={`text-[11px] px-3 py-1.5 rounded border transition-colors ${
                kind === k
                  ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                  : c.btn}`}>
              {EXPORT_META[k].label}
            </button>
          ))}
        </div>
        <p className={`text-[10px] mb-2 ${c.muted}`}>{EXPORT_META[kind].hint}</p>
        {kind === 'bpmn' && !!bpmn && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className={`text-[10px] ${c.muted}`}>für</span>
            {ENGINES.map(e => (
              <button key={e.id} onClick={() => { setEngine(e.id); setHelperShown(null); }}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  engine === e.id
                    ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                    : c.btn}`}>
                {e.label}{e.id === own ? '' : ' · umgewandelt'}
              </button>
            ))}
          </div>
        )}
        {!!issues.length && (
          <div className={`mb-2 text-[10px] px-2 py-1.5 rounded border space-y-0.5 ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
            <div className="flex items-center gap-1 font-semibold"><AlertTriangle size={11} /> {issues.length} Stelle{issues.length === 1 ? '' : 'n'} zum Prüfen</div>
            {issues.map((it, i) => (
              <div key={i}><span className="font-mono">{it.stepId}</span> · {it.where}: {it.text}</div>
            ))}
          </div>
        )}

        {helperShown !== null && (
          <div className={`mb-2 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
            Der Browser lässt das Kopieren nicht zu — den Befehl unten markieren (⌘A / Ctrl+A), kopieren und im Projektordner ins Terminal einfügen.
          </div>
        )}
        <textarea readOnly value={helperShown ?? text}
          onFocus={e => { if (helperShown !== null) e.currentTarget.select(); }}
          className={`flex-1 min-h-[16rem] text-[10px] leading-relaxed font-mono px-3 py-2 rounded border outline-none resize-none ${c.input}`} />

        <div className="flex items-center gap-2 pt-3">
          <span className={`min-w-0 truncate text-[10px] ${c.muted}`}>{(helperShown ?? text).length.toLocaleString('de-CH')} Zeichen · {helperShown !== null ? 'Befehl für ./helper.scala' : fileName}</span>
          <button onClick={copyForHelper}
            title={`Befehl für das Projekt: ./helper.scala processFromSpec orchspec:… — BPMN (${ENGINES.find(e => e.id === engine)?.label ?? engine}) und Scala-Klassen in einem.\nIm Projektordner ins Terminal einfügen und Enter drücken.`}
            className={`ml-auto shrink-0 whitespace-nowrap flex items-center gap-1.5 text-xs px-3 py-2 rounded border ${c.btn}`}>
            {helperCopied !== null
              ? <><Check size={12} /> Befehl kopiert ({helperCopied} KB)</>
              : <><Terminal size={12} /> Process from Spec</>}
          </button>
          <button onClick={copy} className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 text-xs px-3 py-2 rounded border ${c.btn}`}>
            {copied ? <><Check size={12} /> Kopiert</> : <><Copy size={12} /> Kopieren</>}
          </button>
          <button onClick={save} className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 text-xs px-3 py-2 rounded font-semibold ${c.btnPrimary}`}>
            <Download size={12} /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
