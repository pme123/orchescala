// Admin: Auftritt, Katalog, Anmeldung, Benachrichtigungen.
//
// Vier Bereiche, in der Reihenfolge, in der sie gebraucht werden:
//
//  1. **Auftritt** — Kunde und Logo für die Kopfzeile.
//  2. **Katalog** — importieren, exportieren, nachschlagen. Das ist der
//     Bereich, der in **jeder** Umgebung zählt; in der Bankenzone ist es der
//     einzige. Das lokale Erzeugen daraus ist optional und zugeklappt.
//  3. **Anmeldung** — Entra ID.
//  4. **Benachrichtigungen** — Teams-Nachricht bei @-Erwähnungen in Kommentaren.
//
// Oben eine Statusleiste: je Bereich eine Karte mit dem Zustand, Klick
// springt hin. So sieht man auf einen Blick, was eingerichtet ist.
//
// Kein Blättern durch den ganzen Katalog: die Klassen eines Prozesses stehen
// in seiner Spezifikation unter «Datenmodell». Hier bleibt die Suche, für die
// eine Frage, die sich hier stellt — steht das drin?
import { useState } from 'react';
import { BookOpen, ChevronLeft, Image, KeyRound, MessageSquare } from 'lucide-react';
import { useStore } from '../store';
import { GUID_RE, setupLink } from '../auth';
import type { CatalogFile } from '../catalogImport';
import BrandingForm from './BrandingForm';
import CatalogBuild from './CatalogBuild';
import CatalogSearch from './CatalogSearch';
import CatalogTransfer from './CatalogTransfer';
import { AdminSection, SaveRow, StateChip, flashOf, useFlash, type AdminTone } from './adminUi';
import type { Model, TeamsNotifySettings } from '../types';
import { DEFAULT_TEAMS_DELAY_MINUTES, DEFAULT_TEAMS_TEMPLATE } from '../teams';
import { cls } from '../ui';

interface Zustand { tone: AdminTone; label: string; detail?: string }

/** Der Zustand je Bereich — für Statusleiste und Kartenkopf dieselbe Quelle. */
function zustaende(model: Model, generated: CatalogFile | null): Record<'branding' | 'catalog' | 'auth' | 'teams', Zustand> {
  const services = (model.services ?? []).length, types = (model.domainTypes ?? []).length;
  const gen = generated ? (generated.services ?? []).length + (generated.domainTypes ?? []).length : 0;
  const auth = model.auth;
  const authOk = !!auth?.enabled && GUID_RE.test(auth.tenantId.trim()) && GUID_RE.test(auth.clientId.trim());
  const teams = model.notifications?.teams;
  return {
    branding: model.company
      ? { tone: 'ok', label: model.company, detail: model.logo ? 'Name und Logo gesetzt' : 'Name gesetzt, kein Logo' }
      : { tone: 'warn', label: 'nicht eingerichtet', detail: 'Die Kopfzeile heisst «Orch Spec»' },
    catalog: generated
      ? { tone: 'ok', label: 'mitgeliefert', detail: `${(generated.services ?? []).length} Services · ${(generated.domainTypes ?? []).length} Typen` }
      : services + types > 0
        ? { tone: 'ok', label: `${services} Services · ${types} Typen`, detail: 'importiert oder lokal erzeugt' }
        : { tone: 'warn', label: 'leer', detail: gen ? '' : 'Katalog importieren oder lokal erzeugen' },
    auth: !auth?.enabled
      ? { tone: 'off', label: 'aus', detail: 'ohne Anmeldung, jeder darf alles' }
      : authOk
        ? { tone: 'ok', label: 'aktiv', detail: 'Microsoft Entra ID' }
        : { tone: 'error', label: 'IDs fehlen', detail: 'Tenant- oder Client-ID ist keine GUID' },
    teams: !teams?.enabled
      ? { tone: 'off', label: 'aus', detail: 'keine Teams-Nachricht bei Erwähnungen' }
      : authOk
        ? { tone: 'ok', label: 'aktiv', detail: `nach ${teams.delayMinutes ?? DEFAULT_TEAMS_DELAY_MINUTES} Minuten` }
        : { tone: 'warn', label: 'aktiv, ohne Anmeldung', detail: 'Senden braucht die Anmeldung (Entra ID)' },
  };
}

export default function AdminView({ onBack }: { onBack: () => void }) {
  const { isDark, model, saveModel, storage, specs, generatedCatalog } = useStore();
  const c = cls(isDark);

  if (!model) return null;
  const z = zustaende(model, generatedCatalog);
  const bereiche = [
    { id: 'branding', icon: <Image size={13} />, title: 'Auftritt', z: z.branding },
    { id: 'catalog', icon: <BookOpen size={13} />, title: 'Katalog', z: z.catalog },
    { id: 'auth', icon: <KeyRound size={13} />, title: 'Anmeldung', z: z.auth },
    { id: 'teams', icon: <MessageSquare size={13} />, title: 'Teams', z: z.teams },
  ];
  const springe = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
      <div>
        <button onClick={onBack} className={`flex items-center gap-1 text-[11px] ${c.muted} hover:underline`}>
          <ChevronLeft size={12} /> Prozesse
        </button>
        <h1 className={`text-base font-semibold mt-1 ${c.text}`}>Administration</h1>
        <p className={`text-[11px] ${c.muted}`}>Einstellungen für alle, gespeichert in der model.json des Ordners.</p>
      </div>

      {/* Statusleiste: je Bereich eine Karte, Klick springt hin */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {bereiche.map(b => (
          <button key={b.id} onClick={() => springe(b.id)} title={b.z.detail || undefined}
            className={`text-left rounded-lg border px-3 py-2 space-y-1 transition-colors ${c.border2} ${c.hover}`}>
            <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${c.text}`}>
              <span className={c.muted2}>{b.icon}</span>{b.title}
            </span>
            <span className="block"><StateChip tone={b.z.tone} label={b.z.label} isDark={isDark} /></span>
            {b.z.detail && <span className={`block text-[10px] truncate ${c.muted}`}>{b.z.detail}</span>}
          </button>
        ))}
      </div>

      <AdminSection id="branding" icon={<Image size={13} />} title="Auftritt" isDark={isDark}
        state={<StateChip tone={z.branding.tone} label={z.branding.label} isDark={isDark} />}
        hint="Name und Logo stehen links in der Kopfzeile."
        more="Ohne Namen heisst die App dort schlicht «Orch Spec». Das Logo liegt als Data-URI in der model.json — eine zweite Datei im geteilten Ordner wäre umständlicher, eine Adresse von aussen gäbe es in der Bankenzone nicht. Deshalb muss es klein bleiben (bis 200 KB).">
        <BrandingForm model={model} isDark={isDark} onSave={saveModel} />
      </AdminSection>

      <AdminSection id="catalog" icon={<BookOpen size={13} />} title="Katalog" isDark={isDark}
        state={<StateChip tone={z.catalog.tone} label={z.catalog.label} isDark={isDark} title={z.catalog.detail} />}
        hint="Services und Domain-Typen, an denen sich die Spezifikationen messen — importieren, exportieren, nachschlagen."
        more={generatedCatalog
          ? <>Der Katalog kommt mit der App: <span className="font-semibold">catalog.generated.json</span>{' '}
              ({(generatedCatalog.services ?? []).length} Services · {(generatedCatalog.domainTypes ?? []).length} Typen,
              bei jedem Release neu erzeugt). Er hat Vorrang und wird nie in die model.json geschrieben —
              Import und Aufbau unten wirken nur auf den Altbestand daneben.</>
          : <>Der Weg dorthin, wo die Quellen nicht liegen: draussen exportieren, hier importieren. Der Import
              ersetzt den Katalog — er ergänzt ihn nicht, sonst blieben Einträge stehen, die es längst nicht
              mehr gibt. Wo die Quellen liegen, lässt er sich lokal erzeugen (unten, zugeklappt).</>}>
        <CatalogTransfer model={model} specs={specs.map(s => s.data)} isDark={isDark} canEdit onSave={saveModel} />
        <CatalogBuild model={model} isDark={isDark} canEdit onSave={saveModel} />
        <CatalogSearch model={model} isDark={isDark} />
      </AdminSection>

      <AdminSection id="auth" icon={<KeyRound size={13} />} title="Anmeldung" isDark={isDark}
        state={<StateChip tone={z.auth.tone} label={z.auth.label} isDark={isDark} title={z.auth.detail} />}
        hint="Anmeldung über Microsoft Entra ID — Tenant- und Client-ID der App-Registrierung."
        more="Beides sind öffentliche Werte, keine Geheimnisse. Mit «aktiv» braucht auch der lokale Ordner eine Anmeldung; für SharePoint ist sie immer nötig. Die drei Rollen sind App-Rollen der Registrierung: wer keine hat, sieht nichts.">
        <AuthSettingsForm model={model} isDark={isDark} onSave={saveModel} folderUrl={storage?.webUrl} />
      </AdminSection>

      <AdminSection id="teams" icon={<MessageSquare size={13} />} title="Benachrichtigungen (Teams)" isDark={isDark}
        state={<StateChip tone={z.teams.tone} label={z.teams.label} isDark={isDark} title={z.teams.detail} />}
        hint="Wer in einem Kommentar per «@» erwähnt wird oder eine Antwort bekommt, erhält eine Teams-Chat-Nachricht."
        more={<>Gesendet wird von der kommentierenden Person selbst (Microsoft Graph, 1:1-Chat, mit @-Mention und
          Link auf den Kommentar), nach der Wartezeit, gesammelt je Empfänger/in, jede Erwähnung nur einmal.
          Braucht in der App-Registrierung die delegierten Berechtigungen <span className="font-mono">Chat.Create</span>,{' '}
          <span className="font-mono">ChatMessage.Send</span> und <span className="font-mono">User.ReadBasic.All</span>;
          jede Person stimmt beim ersten Mal selbst zu.</>}>
        <TeamsSettingsForm model={model} isDark={isDark} onSave={saveModel} />
      </AdminSection>
    </div>
  );
}

// Teams-Benachrichtigung bei @-Erwähnungen und Antworten in Kommentaren —
// dieselbe Mechanik wie im arch-review (siehe useTeamsNotify).
function TeamsSettingsForm({ model, isDark, onSave }: {
  model: Model; isDark: boolean;
  onSave: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const c = cls(isDark);
  const [draft, setDraft] = useState<TeamsNotifySettings>(model.notifications?.teams ?? { enabled: false });
  const [flash, setFlash] = useFlash();
  const update = (patch: Partial<TeamsNotifySettings>) => { setDraft(d => ({ ...d, ...patch })); setFlash(null); };

  const save = async () => {
    setFlash(flashOf(await onSave({ ...model, notifications: { ...(model.notifications ?? {}), teams: draft } })));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        <label className={`flex items-center gap-2 text-[11px] ${c.muted2}`}>
          <input type="checkbox" checked={draft.enabled === true} onChange={e => update({ enabled: e.target.checked })} />
          Teams-Benachrichtigungen {draft.enabled ? 'aktiv' : 'aus'}
        </label>
        <label className={`flex items-center gap-1.5 text-[11px] ${c.muted}`}>
          Wartezeit nach dem letzten Kommentar
          <input type="number" min={0} max={120} value={draft.delayMinutes ?? DEFAULT_TEAMS_DELAY_MINUTES}
            onChange={e => update({ delayMinutes: Math.max(0, Number(e.target.value) || 0) })}
            className={`w-16 text-[11px] px-2 py-1 rounded border outline-none ${c.input}`} />
          Minuten
        </label>
      </div>
      <div>
        <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>Vorlage Nachricht</label>
        <textarea value={draft.template ?? ''} rows={5}
          onChange={e => update({ template: e.target.value || undefined })}
          placeholder={`Leer = Standard:\n${DEFAULT_TEAMS_TEMPLATE}`}
          className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y font-mono ${c.input}`} />
        <p className={`text-[10px] mt-1 ${c.muted}`}>
          Platzhalter: {'{{empfaenger}} (@-Mention) {{von}} {{prozess}} {{anzahl}} {{kommentare}} {{link}}'}
          {' '}— {'{{kommentare}}'} ist der Block je Kommentar: Stelle, Text, «Kommentar öffnen»-Link.
        </p>
      </div>
      <SaveRow onSave={() => void save()} flash={flash} isDark={isDark} />
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
  const [flash, setFlash] = useFlash();
  const [copied, setCopied] = useState(false);
  const valid = GUID_RE.test(draft.tenantId.trim()) && GUID_RE.test(draft.clientId.trim());

  const save = async () => { setFlash(flashOf(await onSave({ ...model, auth: draft }))); };

  return (
    <div className="space-y-3">
      <label className={`flex items-center gap-2 text-[11px] ${c.muted2}`}>
        <input type="checkbox" checked={draft.enabled} onChange={e => { setDraft({ ...draft, enabled: e.target.checked }); setFlash(null); }} />
        Anmeldung aktiv
      </label>
      {(['tenantId', 'clientId'] as const).map(k => (
        <div key={k}>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>
            {k === 'tenantId' ? 'Verzeichnis-ID (Tenant)' : 'Anwendungs-ID (Client)'}
          </label>
          <input value={draft[k]} onChange={e => { setDraft({ ...draft, [k]: e.target.value }); setFlash(null); }}
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
            <input value={draft[k] ?? ''} onChange={e => { setDraft({ ...draft, [k]: e.target.value }); setFlash(null); }}
              className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
          </div>
        ))}
      </div>
      <SaveRow onSave={() => void save()} flash={flash} isDark={isDark}>
        {valid && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(setupLink(draft.tenantId.trim(), draft.clientId.trim(), folderUrl));
              setCopied(true); window.setTimeout(() => setCopied(false), 2000);
            }}
            title="Link für die Benutzer: richtet Anmeldung und Ordner in einem Schritt ein"
            className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
            <KeyRound size={12} /> {copied ? 'Kopiert' : 'Einrichtungs-Link kopieren'}
          </button>
        )}
      </SaveRow>
    </div>
  );
}
