// Katalog ein- und ausführen.
//
// Der Weg in die Bankenzone: draussen erzeugen, **exportieren**, drinnen
// **importieren**. Der Import **ersetzt** den Katalog — er ergänzt ihn nicht.
// Ergänzen würde alte Einträge stehen lassen, die es längst nicht mehr gibt,
// und genau davor sollte die OpenAPI ja schützen.
//
// Ersetzen kann aber wegnehmen, worauf Spezifikationen zeigen. Deshalb wird
// vorher verglichen und nur dann gefragt, wenn wirklich etwas fehlt.
import { useRef, useState } from 'react';
import { AlertTriangle, Download, Upload } from 'lucide-react';
import { losses, readCatalogFile, referenced, type CatalogFile, type Losses } from '../catalogImport';
import type { Model, ProcessSpec } from '../types';
import { cls } from '../ui';

export default function CatalogTransfer({ model, specs, isDark, canEdit, onSave }: {
  model: Model;
  specs: ProcessSpec[];
  isDark: boolean;
  canEdit: boolean;
  onSave: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [frage, setFrage] = useState<{ data: CatalogFile; verlust: Losses } | null>(null);

  const services = model.services ?? [];
  const types = model.domainTypes ?? [];

  const exportieren = () => {
    const payload = {
      version: 1,
      company: model.company ?? '',
      services,
      domainTypes: types,
      domainSources: (model.domainSources ?? []).filter(x => /^https?:/i.test(x)),
      // Die Reihenfolge reist mit, die lokalen Pfade nicht.
      projects: (model.projects ?? []).map(({ path, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orch-spec-katalog.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const ersetzen = async (data: CatalogFile) => {
    const res = await onSave({
      ...model,
      ...(data.company ? { company: data.company } : {}),
      services: data.services ?? [],
      domainTypes: data.domainTypes ?? [],
      domainSources: data.domainSources ?? [],
      projects: data.projects ?? [],
    });
    setFrage(null);
    setMsg(res.ok
      ? `Katalog ersetzt: ${(data.services ?? []).length} Services, ${(data.domainTypes ?? []).length} Typen.`
      : res.message);
  };

  const einlesen = async (file: File) => {
    setMsg('');
    const gelesen = readCatalogFile(await file.text());
    if (!gelesen.ok) { setMsg(gelesen.message); return; }
    const verlust = losses(model, gelesen.data, referenced(specs));
    if (verlust.services.length || verlust.types.length) { setFrage({ data: gelesen.data, verlust }); return; }
    await ersetzen(gelesen.data);
  };

  return (
    <div className={`rounded border p-4 ${c.border2} ${c.panel}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <div className={`text-[11px] ${c.text}`}>
            {services.length} Services · {types.length} Domain-Typen
          </div>
          <p className={`text-[10px] mt-0.5 ${c.muted}`}>
            Eine Datei mit allem. Der Weg dorthin, wo die Quellen nicht liegen: draussen exportieren,
            hier importieren. <span className={c.muted2}>Der Import ersetzt den Katalog.</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <input ref={fileRef} type="file" accept=".json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void einlesen(f); e.target.value = ''; }} />
          {canEdit && (
            <button onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              <Upload size={12} /> Importieren
            </button>
          )}
          <button onClick={exportieren} disabled={!services.length && !types.length}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
            <Download size={12} /> Exportieren
          </button>
        </div>
      </div>
      {msg && <p className={`text-[11px] mt-2 ${c.muted2}`}>{msg}</p>}

      {frage && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={() => setFrage(null)}>
          <div className={`max-w-xl w-full max-h-[80vh] flex flex-col rounded-xl border p-5 ${c.border2} ${c.panelStrong}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle size={14} className={isDark ? 'text-amber-400 mt-0.5' : 'text-amber-600 mt-0.5'} />
              <h3 className={`text-sm font-semibold ${c.text}`}>Der neue Katalog kennt weniger</h3>
            </div>
            <p className={`text-[11px] leading-relaxed mb-3 ${c.muted2}`}>
              {frage.verlust.services.length > 0 && `${frage.verlust.services.length} Service(s)`}
              {frage.verlust.services.length > 0 && frage.verlust.types.length > 0 && ' und '}
              {frage.verlust.types.length > 0 && `${frage.verlust.types.length} Domain-Typ(en)`}
              {' '}werden in Spezifikationen verwendet, stehen aber nicht im neuen Katalog. Die
              Spezifikationen bleiben, wie sie sind — die Verweise darin zeigen danach ins Leere und
              werden rot angezeigt.
            </p>
            <div className={`flex-1 overflow-y-auto rounded border text-[10px] font-mono px-3 py-2 space-y-0.5 ${c.border2}`}>
              {frage.verlust.services.map(s => (
                <div key={s.id} className={c.muted2}>{s.id}</div>
              ))}
              {frage.verlust.types.map(t => (
                <div key={t.id} className={c.muted}>{t.name} <span className="opacity-60">({t.pkg})</span></div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-3">
              <span className={`text-[10px] ${c.muted}`}>
                {(frage.data.services ?? []).length} Services · {(frage.data.domainTypes ?? []).length} Typen kommen herein
              </span>
              <button onClick={() => setFrage(null)}
                className={`ml-auto text-xs px-3 py-2 rounded border ${c.btn}`}>Abbrechen</button>
              <button onClick={() => void ersetzen(frage.data)}
                className={`text-xs px-3 py-2 rounded font-semibold ${c.btnPrimary}`}>Trotzdem ersetzen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
