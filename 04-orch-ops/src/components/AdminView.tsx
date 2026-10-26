// Admin: branding, status values, Confluence import and sign-in.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, FileUp, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useStore, type ImportSummary } from '../store';
import { DEFAULT_ROLES, GUID_RE, setupLink, useAuth, withRoles } from '../auth';
import RoleFields from './RoleFields';
import BrandingForm from './BrandingForm';
import { IMPORT_COUNT } from '../confluence';
import type { Model, StatusDef } from '../types';
import { STATUS_COLORS, StatusTag, cls } from '../ui';

const COLOR_LABEL: Record<string, string> = {
  neutral: 'grau', blue: 'blau', green: 'grün', yellow: 'gelb', red: 'rot', purple: 'violett',
};

export default function AdminView({ onBack }: { onBack: () => void }) {
  const { isDark, model, saveModel, storage } = useStore();
  const c = cls(isDark);
  if (!model) return null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
      <button onClick={onBack} className={`flex items-center gap-1 text-[11px] ${c.muted} hover:underline`}>
        <ChevronLeft size={12} /> Fehler
      </button>

      <section className="space-y-3">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Auftritt</h1>
        <BrandingForm model={model} isDark={isDark} onSave={saveModel} />
      </section>

      <section className="space-y-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Status-Werte</h2>
        <StatusEditor key={JSON.stringify(model.statuses)} model={model} isDark={isDark} onSave={saveModel} />
      </section>

      <section className="space-y-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Import aus Confluence</h2>
        <ConfluenceImport isDark={isDark} />
      </section>

      <section className="space-y-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Anmeldung (Microsoft Entra ID)</h2>
        <AuthSettingsForm model={model} isDark={isDark} onSave={saveModel} folderUrl={storage?.webUrl} />
      </section>
    </div>
  );
}

// ── Status values ───────────────────────────────────────────────────────────
function StatusEditor({ model, isDark, onSave }: {
  model: Model; isDark: boolean; onSave: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const { errors } = useStore();
  const c = cls(isDark);
  const [list, setList] = useState<StatusDef[]>(model.statuses);
  const [msg, setMsg] = useState('');
  const used = (label: string) => errors.filter(e => e.data.status.includes(label)).length;
  const dirty = JSON.stringify(list) !== JSON.stringify(model.statuses);

  const upd = (i: number, patch: Partial<StatusDef>) => setList(l => l.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setList(l => {
    const n = [...l]; const j = i + d;
    if (j < 0 || j >= n.length) return l;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const save = async () => {
    const labels = list.map(s => s.label.trim().toUpperCase());
    if (labels.some(l => !l)) { setMsg('Jeder Status braucht einen Namen.'); return; }
    if (new Set(labels).size !== labels.length) { setMsg('Jeder Name nur einmal.'); return; }
    const r = await onSave({ ...model, statuses: list.map((s, i) => ({ ...s, label: labels[i] })) });
    setMsg(r.ok ? 'Gespeichert.' : r.message);
  };

  return (
    <div className={`rounded border p-4 space-y-3 ${c.border2} ${c.panel}`}>
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Die Tags zum Filtern und Setzen, in dieser Reihenfolge. «Erledigt» dämpft einen Fehler in der Liste.
        Ein Status, der an Fehlern hängt, bleibt dort stehen, auch wenn er hier fehlt — umbenennen ändert die Fehler nicht.
      </p>
      <ul className="space-y-1.5">
        {list.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <div className="w-44 flex-shrink-0"><StatusTag label={s.label || '…'} statuses={list} isDark={isDark} /></div>
            <input value={s.label} onChange={e => upd(i, { label: e.target.value })}
              className={`flex-1 text-[11px] px-2 py-1 rounded border outline-none uppercase ${c.input}`} />
            <select value={s.color} onChange={e => upd(i, { color: e.target.value as StatusDef['color'] })}
              className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
              {STATUS_COLORS.map(col => <option key={col} value={col}>{COLOR_LABEL[col]}</option>)}
            </select>
            <label className={`flex items-center gap-1 text-[10px] ${c.muted2}`}>
              <input type="checkbox" checked={!!s.done} onChange={e => upd(i, { done: e.target.checked || undefined })} /> erledigt
            </label>
            <span className={`text-[10px] w-14 text-right ${c.muted}`}>{used(s.label)}×</span>
            <button onClick={() => move(i, -1)} className={`p-1 ${c.muted}`} title="nach oben"><ArrowUp size={11} /></button>
            <button onClick={() => move(i, 1)} className={`p-1 ${c.muted}`} title="nach unten"><ArrowDown size={11} /></button>
            <button onClick={() => setList(l => l.filter((_, k) => k !== i))} className={`p-1 ${c.muted}`}
              title={used(s.label) ? `Hängt an ${used(s.label)} Fehlern — bleibt dort stehen` : 'Entfernen'}><Trash2 size={11} /></button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button onClick={() => setList(l => [...l, { label: '', color: 'neutral' }])}
          className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}><Plus size={11} /> Status</button>
        <button onClick={() => void save()} disabled={!dirty}
          className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>Speichern</button>
        {msg && <span className={`text-[10px] ${c.muted}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ── Confluence import ───────────────────────────────────────────────────────
function ConfluenceImport({ isDark }: { isDark: boolean }) {
  const { importConfluence } = useStore();
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState('');
  // the page has no counter — what imported errors start with
  const [initialCount, setInitialCount] = useState(IMPORT_COUNT);

  const run = async (f: File) => {
    setBusy(true); setErr(''); setResult(null);
    const r = await importConfluence(await f.text(), initialCount);
    setBusy(false);
    if (r.ok) setResult(r.summary); else setErr(r.message);
  };

  return (
    <div className={`rounded border p-4 space-y-3 ${c.border2} ${c.panel}`}>
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Die Confluence-Seite mit der Fehlertabelle als HTML speichern (Browser: «Seite speichern unter» oder
        «Quelltext anzeigen» → speichern) und hier wählen. Gelesen wird die Tabelle der wiederkehrenden Fehler
        und der How-to-Abschnitt. Bereits vorhandene Fehler bleiben unangetastet — der Import lässt sich wiederholen.
        Die Seite hat keinen Zähler: importierte Fehler starten mit dem Count unten — 2, weil die Seite Fehler
        ab dem 2. Vorkommnis dokumentiert. Hat die Tabelle eine Spalte «Anzahl» oder «Count», gilt deren Wert.
      </p>
      <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = ''; }} />
      <div className="flex items-center gap-3 flex-wrap">
        <label className={`flex items-center gap-1.5 text-[11px] ${c.muted2}`} title="Count, mit dem importierte Fehler starten">
          Count beim Import
          <select value={initialCount} onChange={e => setInitialCount(Number(e.target.value))} disabled={busy}
            className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
            {[0, 1, 2].map(n => <option key={n} value={n}>{n}{n === IMPORT_COUNT ? ' (ab 2. Vorkommnis)' : ''}</option>)}
          </select>
        </label>
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border disabled:opacity-50 ${c.btn}`}>
          <FileUp size={12} /> {busy ? 'Importiere …' : 'HTML-Datei wählen'}
        </button>
        {result && (
          <span className={`text-[11px] ${c.muted2}`}>
            {result.total} Fehler gelesen · {result.created} neu · {result.skipped} schon vorhanden
            {result.statusesAdded > 0 && <> · {result.statusesAdded} Status ergänzt</>}
            {result.howto && <> · How-to übernommen</>}
          </span>
        )}
        {err && <span className={`text-[11px] ${c.error}`}>{err}</span>}
      </div>
    </div>
  );
}

// ── Sign-in ─────────────────────────────────────────────────────────────────
function AuthSettingsForm({ model, isDark, onSave, folderUrl }: {
  model: Model; isDark: boolean; folderUrl?: string;
  onSave: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const c = cls(isDark);
  const auth = useAuth();
  // not set up yet: suggest this browser's IDs and the default roles
  const a = model.auth ?? {
    enabled: false, tenantId: auth.ids?.tenantId ?? '', clientId: auth.ids?.clientId ?? '', ...DEFAULT_ROLES,
  };
  const [draft, setDraft] = useState(a);
  const [msg, setMsg] = useState('');
  const valid = GUID_RE.test(draft.tenantId.trim()) && GUID_RE.test(draft.clientId.trim());
  // the IDs of this browser may only be known after mount: fill in empty fields
  const ids = model.auth ? null : auth.ids;
  useEffect(() => {
    if (!ids) return;
    setDraft(d => ({ ...d, tenantId: d.tenantId || ids.tenantId, clientId: d.clientId || ids.clientId }));
  }, [ids?.tenantId, ids?.clientId]);

  const save = async () => {
    const res = await onSave({
      ...model,
      auth: withRoles({ ...draft, tenantId: draft.tenantId.trim(), clientId: draft.clientId.trim() }, draft),
    });
    setMsg(res.ok ? 'Gespeichert.' : res.message);
  };

  return (
    <div className={`rounded border p-4 space-y-3 ${c.border2} ${c.panel}`}>
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Tenant- und Client-ID der App-Registrierung (öffentliche Werte, keine Geheimnisse).
        Mit «aktiv» braucht auch der lokale Ordner eine Anmeldung; für SharePoint ist sie immer nötig.
      </p>
      <label className={`flex items-center gap-2 text-[11px] ${c.muted2}`}>
        <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
        Anmeldung aktiv
      </label>
      {(['tenantId', 'clientId'] as const).map(k => (
        <div key={k}>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>
            {k === 'tenantId' ? 'Verzeichnis-ID (Tenant)' : 'Anwendungs-ID (Client)'}
          </label>
          <input value={draft[k]} onChange={e => setDraft({ ...draft, [k]: e.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
        </div>
      ))}
      <RoleFields roles={draft} isDark={isDark} onChange={r => setDraft({ ...draft, ...r })} />
      <div className="flex items-center gap-2">
        <button onClick={save} className={`text-[11px] px-3 py-1.5 rounded font-semibold ${c.btnPrimary}`}>Speichern</button>
        {valid && (
          <button
            onClick={() => navigator.clipboard.writeText(setupLink(draft.tenantId.trim(), draft.clientId.trim(), folderUrl))}
            title="Link für die Benutzer: richtet Anmeldung und Ordner in einem Schritt ein"
            className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
            <KeyRound size={12} /> Einrichtungs-Link kopieren
          </button>
        )}
        {msg && <span className={`text-[10px] ${c.muted}`}>{msg}</span>}
      </div>
    </div>
  );
}
