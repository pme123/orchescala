// The pages of the app (E15) - one page per file in `pages/`, the app settings in `pages/app.json`.
import { AlertTriangle, AppWindow, Flag, LayoutTemplate, Plus, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { aiEnabled, useAiKey } from '../../ai/key';
import { usePermissions } from '../../auth';
import { useConfirm } from '../../components/Confirm';
import { useStore } from '../../store';
import { EpicChip, cls, epicTone } from '../../ui';
import { epicsOf } from '../../epics';
import type { App, Page } from '../runtime/spec';
import { JsonField, SelectField, TextField } from './fields';
import { flatten, pageFindings, slugOf, targetsOf } from './model';
import { appProblem } from '../runtime/validate';
import { AccessChip } from './PageEditor';
import { ThemeEditor } from './ThemeEditor';

const EPIC_FILTER_KEY = 'orch-spec.pageEpicFilter';

export default function PagesView({ onOpen }: { onOpen: (slug: string, aiPrompt?: string) => void }) {
  const { isDark, model, specs, pages, pagesApp, pagesUnreadable, createPage, deletePage, savePagesApp } = useStore();
  const { canEdit, canDelete } = usePermissions();
  const confirm = useConfirm();
  const c = cls(isDark);
  const [creating, setCreating] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const targets = useMemo(() => (model ? targetsOf(model, specs.map((s) => s.data)) : null), [model, specs]);
  // the epics as a filter - like the list of processes: those that pages carry
  const [listEpic, setListEpic] = useState<string | null>(() => { try { return localStorage.getItem(EPIC_FILTER_KEY); } catch { return null; } });
  const pickEpic = (id: string | null) => {
    setListEpic(id);
    try { if (id) localStorage.setItem(EPIC_FILTER_KEY, id); else localStorage.removeItem(EPIC_FILTER_KEY); } catch { /* ignore */ }
  };
  const epicFilter = (model?.epics ?? [])
    .map((e) => ({ ...e, n: pages.filter((p) => p.data.spec?.epics?.includes(e.id)).length }))
    .filter((e) => e.n > 0);
  const activeEpic = listEpic && epicFilter.some((e) => e.id === listEpic) ? listEpic : null;
  const shown = activeEpic ? pages.filter((p) => p.data.spec?.epics?.includes(activeEpic)) : pages;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-1">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Seiten der App</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setAppOpen((o) => !o)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
            <Settings2 size={12} /> App
          </button>
          {canEdit && (
            <button onClick={() => setCreating(true)}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-transparent ${c.btnPrimary}`}>
              <Plus size={12} /> Neu
            </button>
          )}
        </div>
      </div>
      <p className={`text-[11px] mb-4 ${c.muted}`}>
        Was nur liest oder einen Prozess anstösst, ist eine Seite (E14) – öffentlich oder mit Login. Die App zeigt sie
        zur Laufzeit mit demselben Renderer wie die Vorschau hier (E15); die Worker-App liefert sie unter /app/{'{projekt}'}/ aus.
      </p>

      {appOpen && <AppSettings app={pagesApp?.data ?? {}} pages={pages.map((p) => p.data)} canEdit={canEdit}
        onSave={async (app) => {
          const r = await savePagesApp(app, pagesApp?.version ?? null);
          if (r.status === 'saved') setAppOpen(false);
          // the inputs stay here - copy first, then reload, otherwise they are gone
          return r.status === 'saved' ? null : r.status === 'conflict' ? 'Die Datei wurde inzwischen geändert – deine Eingaben bleiben hier stehen; die andere Fassung zeigt erst ein Neuladen der Seite.' : r.message;
        }}
        onClose={() => setAppOpen(false)} />}
      {creating && <NewPage existing={pages.map((p) => p.slug)}
        onCreate={async (slug, page, aiPrompt) => { const r = await createPage(slug, page); if (r.ok) { setCreating(false); onOpen(slug, aiPrompt); } return r; }}
        onClose={() => setCreating(false)} />}

      {epicFilter.length > 0 && (
        <div className="mb-2 flex items-center gap-1 flex-wrap">
          <Flag size={10} className={c.muted} />
          {epicFilter.map((e) => (
            <button key={e.id} onClick={() => pickEpic(activeEpic === e.id ? null : e.id)}
              title={`Nur Seiten im Epic «${e.name}»${e.description ? ` — ${e.description}` : ''}${e.closed ? ' (abgeschlossen)' : ''}`}
              className={`text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${epicTone(isDark)} ${
                e.closed ? 'border-dashed' : ''} ${activeEpic && activeEpic !== e.id ? 'opacity-30' : ''} ${activeEpic === e.id ? 'ring-1 ring-current' : ''}`}>
              {e.name} {e.n}
            </button>
          ))}
          {activeEpic && <button onClick={() => pickEpic(null)} className={`ml-1 text-[10px] ${c.muted} hover:underline`}>Filter aus</button>}
        </div>
      )}
      {deleteError && <p className="mb-2 text-[11px] text-rose-500">{deleteError}</p>}
      {/* e.g. after deleting the start page - the app would find no page for / */}
      {pagesApp?.data.home && !pages.some((p) => p.data.path === pagesApp.data.home) && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-600">
          <AlertTriangle size={11} /> Die Startseite «/{pagesApp.data.home}» gibt es nicht (mehr) – unter «App» eine andere wählen.
        </p>
      )}
      {/* there, but not readable: otherwise you would not see it - and «Neu» with the same name would fail mysteriously */}
      {pagesUnreadable.length > 0 && (
        <div className={`mb-3 rounded border p-2.5 space-y-1 ${isDark ? 'border-rose-500/30 bg-rose-500/10' : 'border-rose-300 bg-rose-50'}`}>
          {pagesUnreadable.map((u) => (
            <div key={u.file} className="flex items-start gap-1.5 text-[11px] text-rose-500">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span><span className="font-mono">pages/{u.file}</span> ist nicht lesbar – {u.problem}. Bitte im Ordner von Hand reparieren.</span>
            </div>
          ))}
        </div>
      )}
      {pages.length === 0 ? (
        <div className={`rounded border p-6 text-center ${c.border2}`}>
          <LayoutTemplate size={20} className={`mx-auto mb-2 ${c.muted}`} />
          <p className={`text-xs ${c.muted2}`}>Noch keine Seiten – im Ordner fehlt <span className="font-mono">pages/</span>.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {shown.map(({ slug, data, version }) => {
            const findings = targets ? pageFindings(data, targets, pages.map((p) => p.data)).filter((f) => f.level !== 'info') : [];
            const errors = findings.filter((f) => f.level === 'error').length;
            return (
              <div key={slug} className={`rounded border ${c.border2} ${c.hover} flex items-center`}>
                <button onClick={() => onOpen(slug)} className="min-w-0 flex-1 text-left px-3 py-2.5 flex items-center gap-3">
                  <AppWindow size={14} className={c.muted} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-semibold truncate ${c.text}`}>{data.title || slug}</div>
                    <div className={`text-[10px] font-mono truncate ${c.muted}`}>/{data.path}{data.spec?.project ? ` · ${data.spec.project}` : ''}</div>
                  </div>
                  {epicsOf({ epics: data.spec?.epics }, model).map((e) => <EpicChip key={e.id} name={e.name} closed={e.closed} isDark={isDark} />)}
                  <span className={`hidden sm:inline text-[9px] ${c.muted}`}>{flatten(data.body).length} Bausteine</span>
                  <AccessChip isDark={isDark} page={data} />
                  {findings.length > 0 ? (
                    <span title={findings.map((f) => f.message).join('\n')}
                      className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${
                        errors ? (isDark ? 'border-rose-500/30 bg-rose-500/15 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')
                          : (isDark ? 'border-amber-500/30 bg-amber-500/15 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700')}`}>
                      <AlertTriangle size={9} />{findings.length}
                    </span>
                  ) : <span className="w-8" />}
                </button>
                {canDelete && (
                  <button title="Seite löschen"
                    onClick={async () => {
                      if (!(await confirm({ title: `Seite «${data.title || slug}» löschen?` }))) return;
                      const r = await deletePage(slug, version);
                      setDeleteError(r.ok ? null : r.message);
                    }}
                    className={`p-2 mr-1 rounded ${c.muted} hover:text-rose-500`}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewPage({ existing, onCreate, onClose }: {
  existing: string[]; onCreate: (slug: string, page: Page, aiPrompt?: string) => Promise<{ ok: true } | { ok: false; message: string }>; onClose: () => void;
}) {
  const { isDark } = useStore();
  // with a key (AI mode): what the page should show - Claude drafts it right after creating
  const aiKey = useAiKey();
  const [describe, setDescribe] = useState('');
  const c = cls(isDark);
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [access, setAccess] = useState<'public' | 'login'>('public');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const slug = slugOf(path || title);
  // pages/app.json holds the app settings - not a name for a page
  const taken = existing.includes(slug) || slug === 'app';
  return (
    <div className={`mb-4 p-3 rounded border space-y-2 ${c.border2} ${c.panel}`}>
      <div className="grid grid-cols-3 gap-2">
        <TextField isDark={isDark} label="Titel" value={title} onChange={setTitle} placeholder="Termin buchen" />
        <TextField isDark={isDark} label="Pfad" mono value={path} onChange={setPath} placeholder="appointments/book" />
        <SelectField isDark={isDark} label="Zugang" value={access} onChange={setAccess}
          options={[{ value: 'public', label: 'öffentlich' }, { value: 'login', label: 'mit Login' }]} />
      </div>
      {aiEnabled(aiKey) && (
        <TextField isDark={isDark} label="Beschreibung für Claude" hint="optional – Claude entwirft die Seite gleich nach dem Anlegen" multiline
          value={describe} onChange={setDescribe} placeholder="Eine Seite, auf der Kunden ihre Adresse ändern: Strasse, PLZ, Ort, gültig ab …" />
      )}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-mono ${taken ? 'text-rose-500' : c.muted}`}>pages/{slug}.json{slug === 'app' ? ' – reserviert für die Einstellungen der App' : taken ? ' – gibt es schon' : ''}</span>
        {error && <span className="text-[10px] text-rose-500">{error}</span>}
        <button onClick={onClose} className={`ml-auto text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
        {/* a path made only of characters like / or ä gives no file name; a double click does not create twice */}
        <button disabled={!title.trim() || !path.trim() || !slug || taken || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await onCreate(slug, {
                path: path.trim(), title: title.trim(), access: access === 'public' ? 'public' : { roles: [] },
                state: {}, body: [{ type: 'heading', text: title.trim() }],
              }, aiEnabled(aiKey) && describe.trim() ? describe.trim() : undefined);
              if (!r.ok) setError(r.message);
            } finally {
              setBusy(false);
            }
          }}
          className={`text-[11px] px-2.5 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
          Anlegen
        </button>
      </div>
    </div>
  );
}

function AppSettings({ app, pages, canEdit, onSave, onClose }: {
  app: App; pages: Page[]; canEdit: boolean; onSave: (app: App) => Promise<string | null>; onClose: () => void;
}) {
  const { isDark } = useStore();
  const c = cls(isDark);
  const [draft, setDraft] = useState<App>(app);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`mb-4 p-3 rounded border space-y-2 ${c.border2} ${c.panel}`}>
      <div className="grid grid-cols-3 gap-2">
        <TextField isDark={isDark} label="Titel der App" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
        <TextField isDark={isDark} label="Untertitel" value={draft.subtitle} onChange={(subtitle) => setDraft({ ...draft, subtitle })} />
        <SelectField isDark={isDark} label="Startseite" value={draft.home ?? ''} onChange={(home) => setDraft({ ...draft, home: home || undefined })}
          options={[{ value: '', label: '–' }, ...pages.map((p) => ({ value: p.path, label: `${p.title} (/${p.path})` }))]} />
      </div>
      <details className={`rounded border ${c.border2}`}>
        <summary className={`px-2 py-1.5 text-[11px] cursor-pointer ${c.muted2}`}>Auftritt (Theme){draft.theme ? ' · eigenes' : ''}</summary>
        <div className="p-2">
          <ThemeEditor isDark={isDark} theme={draft.theme} onChange={(theme) => setDraft({ ...draft, theme })} canEdit={canEdit} />
        </div>
      </details>
      <JsonField isDark={isDark} label="Texte für Werte" hint="{{wert|label:topic}} – je Name die Texte der Werte" rows={8}
        value={draft.labels} onChange={(labels) => setDraft({ ...draft, labels: labels as App['labels'] })} />
      <div className="flex items-center justify-end gap-2">
        {error && <span className="mr-auto text-[10px] text-rose-500">{error}</span>}
        <button onClick={onClose} className={`text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Schliessen</button>
        {canEdit && (
          <button onClick={async () => {
            // the same check as on reading - a wrong shape would otherwise end up in app.json and break the app
            const problem = appProblem(draft);
            setError(problem ? `So nicht speicherbar: ${problem}` : await onSave(draft));
          }} className={`text-[11px] px-2.5 py-1.5 rounded border border-transparent ${c.btnPrimary}`}>
            Speichern
          </button>
        )}
      </div>
    </div>
  );
}
