// Admin: Katalog und Anmeldung.
//
// Drei Bereiche, in der Reihenfolge, in der sie gebraucht werden:
//
//  1. **Auftritt** — Kunde und Logo für die Kopfzeile.
//  2. **Katalog** — importieren, exportieren, nachschlagen. Das ist der
//     Bereich, der in **jeder** Umgebung zählt; in der Bankenzone ist es der
//     einzige. Das lokale Erzeugen daraus ist optional und zugeklappt.
//  3. **Anmeldung** — Entra ID.
//
// Kein Blättern durch den ganzen Katalog: die Klassen eines Prozesses stehen
// in seiner Spezifikation unter «Datenmodell». Hier bleibt die Suche, für die
// eine Frage, die sich hier stellt — steht das drin?
import { useState } from 'react';
import { ChevronLeft, KeyRound } from 'lucide-react';
import { useStore } from '../store';
import { GUID_RE, setupLink } from '../auth';
import BrandingForm from './BrandingForm';
import CatalogBuild from './CatalogBuild';
import CatalogSearch from './CatalogSearch';
import CatalogTransfer from './CatalogTransfer';
import type { Model } from '../types';
import { cls } from '../ui';

export default function AdminView({ onBack }: { onBack: () => void }) {
  const { isDark, model, saveModel, storage, specs, generatedCatalog } = useStore();
  const c = cls(isDark);

  if (!model) return null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
      <button onClick={onBack} className={`flex items-center gap-1 text-[11px] ${c.muted} hover:underline`}>
        <ChevronLeft size={12} /> Prozesse
      </button>

      <section className="space-y-3">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Auftritt</h1>
        <BrandingForm model={model} isDark={isDark} onSave={saveModel} />
      </section>

      <section className="space-y-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Katalog</h2>
        {generatedCatalog && (
          <p className={`text-[11px] ${c.muted}`}>
            Der Katalog kommt mit der App: <span className="font-semibold">catalog.generated.json</span>{' '}
            ({(generatedCatalog.services ?? []).length} Services · {(generatedCatalog.domainTypes ?? []).length} Typen,
            bei jedem Release neu erzeugt). Er hat Vorrang und wird nie in die model.json geschrieben —
            Import und Aufbau unten wirken nur auf den Altbestand daneben.
          </p>
        )}
        <CatalogTransfer model={model} specs={specs.map(s => s.data)} isDark={isDark} canEdit onSave={saveModel} />
        <CatalogBuild model={model} isDark={isDark} canEdit onSave={saveModel} />
        <CatalogSearch model={model} isDark={isDark} />
      </section>

      <section className="space-y-3">
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Anmeldung (Microsoft Entra ID)</h2>
        <AuthSettingsForm model={model} isDark={isDark} onSave={saveModel} folderUrl={storage?.webUrl} />
      </section>
    </div>
  );
}

function AuthSettingsForm({ model, isDark, onSave, folderUrl }: {
  model: Model; isDark: boolean; folderUrl?: string;
  onSave: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const c = cls(isDark);
  const a = model.auth ?? { enabled: false, tenantId: '', clientId: '' };
  const [draft, setDraft] = useState(a);
  const [msg, setMsg] = useState('');
  const valid = GUID_RE.test(draft.tenantId.trim()) && GUID_RE.test(draft.clientId.trim());

  const save = async () => {
    const res = await onSave({ ...model, auth: draft });
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
      <div className="grid grid-cols-3 gap-2">
        {(['adminRole', 'reviewerRole', 'viewerRole'] as const).map(k => (
          <div key={k}>
            <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>
              {k === 'adminRole' ? 'Admin' : k === 'reviewerRole' ? 'Bearbeiten' : 'Lesen'}
            </label>
            <input value={draft[k] ?? ''} onChange={e => setDraft({ ...draft, [k]: e.target.value })}
              className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
          </div>
        ))}
      </div>
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
