// Export-Dialog: Zielgruppe wählen, Ergebnis prüfen, kopieren oder speichern.
import { useMemo, useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { EXPORT_META, exportFileName, exportSpec, type ExportKind } from '../exporters';
import type { Model, ProcessSpec } from '../types';
import { cls } from '../ui';

const KINDS: ExportKind[] = ['fachlich', 'orchescala', 'scala', 'bpmn', 'json'];

export default function ExportDialog({ spec, model, bpmn, isDark, onClose }: {
  spec: ProcessSpec; model: Model | null; bpmn?: string; isDark: boolean; onClose: () => void;
}) {
  const c = cls(isDark);
  const [kind, setKind] = useState<ExportKind>('orchescala');
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => exportSpec(spec, kind, model, bpmn), [spec, kind, model, bpmn]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // restriktive Umgebung: Text ist im Feld markierbar
    }
  };

  const save = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(spec, kind);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className={`max-w-3xl w-full max-h-[85vh] flex flex-col rounded-xl border p-5 ${c.border2} ${c.panelStrong}`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className={`text-sm font-semibold ${c.text}`}>Export — {spec.title}</h3>
          <button onClick={onClose} className={`p-1 ${c.muted}`}><X size={14} /></button>
        </div>

        <div className="flex gap-2 mb-2">
          {KINDS.map(k => (
            <button key={k} onClick={() => setKind(k)}
              className={`text-[11px] px-3 py-1.5 rounded border transition-colors ${
                kind === k
                  ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                  : c.btn}`}>
              {EXPORT_META[k].label}
            </button>
          ))}
        </div>
        <p className={`text-[10px] mb-2 ${c.muted}`}>{EXPORT_META[kind].hint}</p>

        <textarea readOnly value={text}
          className={`flex-1 min-h-[16rem] text-[10px] leading-relaxed font-mono px-3 py-2 rounded border outline-none resize-none ${c.input}`} />

        <div className="flex items-center gap-2 pt-3">
          <span className={`text-[10px] ${c.muted}`}>{text.length.toLocaleString('de-CH')} Zeichen · {exportFileName(spec, kind)}</span>
          <button onClick={copy} className={`ml-auto flex items-center gap-1.5 text-xs px-3 py-2 rounded border ${c.btn}`}>
            {copied ? <><Check size={12} /> Kopiert</> : <><Copy size={12} /> Kopieren</>}
          </button>
          <button onClick={save} className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded font-semibold ${c.btnPrimary}`}>
            <Download size={12} /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
