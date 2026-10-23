// The pages of the app (E15) - one page per file in `pages/`, the app settings in `pages/app.json`.
import { AlertTriangle, AppWindow, ArrowUpRight, ClipboardCheck, LayoutTemplate, MessageSquare, Plus, Settings2, Trash2 } from 'lucide-react';
import { ProjectGroups, SpecListHead, useSpecList, type ListEntry } from '../../components/SpecList';
import { useMemo, useState } from 'react';
import { aiEnabled, useAiKey } from '../../ai/key';
import { usePermissions } from '../../auth';
import { useConfirm } from '../../components/Confirm';
import { useStore, type PageListItem } from '../../store';
import { EpicChip, cls } from '../../ui';
import { epicsOf } from '../../epics';
import type { App, Page } from '../runtime/spec';
import { JsonField, SelectField, TextField } from './fields';
import { flatten, pageFindings, slugOf, targetsOf } from './model';
import { taskStepText, userTasksOfPage, userTaskSteps } from '../taskLinks';
import { appProblem } from '../runtime/validate';
import { AccessChip } from './PageEditor';
import { ThemeEditor } from './ThemeEditor';

/** What the head of the list knows of a page - pages have no time of change (yet). */
const pageEntry = ({ slug, data }: PageListItem): ListEntry => ({
  title: data.title, terms: [data.path, slug], project: data.spec?.project, epics: data.spec?.epics,
});

export default function PagesView({ onOpen, onOpenTask }: {
  /** `notice`: a warning for the editor - e.g. the first log entry of a new page was not written */
  onOpen: (slug: string, aiPrompt?: string, notice?: string) => void;
  /** to the user task of a page - the process at its step */
  onOpenTask?: (specSlug: string, stepId: string) => void;
}) {
  const { isDark, model, specs, pages, pagesApp, pagesUnreadable, createPage, deletePage, savePagesApp } = useStore();
  const { canEdit, canDelete } = usePermissions();
  const confirm = useConfirm();
  const c = cls(isDark);
  const [creating, setCreating] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const targets = useMemo(() => (model ? targetsOf(model, specs.map((s) => s.data)) : null), [model, specs]);
  // search, epics and the groups per project - the same head as the list of processes (SpecList.tsx)
  const list = useSpecList(pages, pageEntry, model);
  const { groups } = list;
  // per page: the user tasks it completes and where they are - once per change of pages or specs
  const taskInfo = useMemo(() => new Map(pages.map((p) => [p.slug,
    userTasksOfPage(p.data).map((key) => ({ key, steps: userTaskSteps(key, specs) }))])), [pages, specs]);

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
        onCreate={async (slug, page, aiPrompt) => { const r = await createPage(slug, page);
          if (r.ok) { setCreating(false); onOpen(slug, aiPrompt, r.auditError && `Angelegt, aber der erste Eintrag im Änderungsprotokoll nicht: ${r.auditError}`); }
          return r; }}
        onClose={() => setCreating(false)} />}

      {pages.length > 0 && <SpecListHead isDark={isDark} list={list} placeholder="Titel, Pfad, Projekt …" noun="Seiten" />}
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
      ) : !list.visible.length ? (
        <div className={`text-xs ${c.muted} py-10 text-center`}>
          Keine Seite passt zu Suche und Filter.
          <button onClick={list.reset} className="ml-1.5 hover:underline">Filter aus</button>
        </div>
      ) : (
        <ProjectGroups isDark={isDark} groups={groups} noun={['Seite', 'Seiten']} render={({ slug, data, version }) => {
            const findings = targets ? pageFindings(data, targets, pages.map((p) => p.data)).filter((f) => f.level !== 'info') : [];
            const errors = findings.filter((f) => f.level === 'error').length;
            // a page for a user task (it completes one) or a simple page
            const tasks = taskInfo.get(slug) ?? [];
            const goal = tasks.find((t) => t.steps.length)?.steps[0];
            // a key in several processes: the link goes to the first - said in the chip, not only in the tooltip
            const ambiguous = tasks.some((t) => t.steps.length > 1);
            const chip = 'text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap';
            const sky = isDark ? 'border-sky-500/30 bg-sky-500/15 text-sky-200' : 'border-sky-300 bg-sky-50 text-sky-800';
            const taskTitle = `Seite für den Benutzer-Task (schliesst ihn ab):\n${tasks.map((t) => taskStepText(t.key, t.steps)).join('\n')}`;
            return (
              <div key={slug} className={`rounded border ${c.border2} ${c.hover} flex items-center`}>
                <button onClick={() => onOpen(slug)} className="min-w-0 flex-1 text-left px-3 py-2.5 flex items-center gap-3">
                  {tasks.length ? <ClipboardCheck size={14} className={isDark ? 'text-sky-300' : 'text-sky-700'} /> : <AppWindow size={14} className={c.muted} />}
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-semibold truncate ${c.text}`}>{data.title || slug}</div>
                    <div className={`text-[10px] font-mono truncate ${c.muted}`}>/{data.path}{data.spec?.project ? ` · ${data.spec.project}` : ''}</div>
                  </div>
                  {epicsOf({ epics: data.spec?.epics }, model).map((e) => <EpicChip key={e.id} name={e.name} closed={e.closed} isDark={isDark} />)}
                  <span className={`hidden sm:inline text-[9px] ${c.muted}`}>{flatten(data.body).length} Bausteine</span>
                  {/* open comments - need for clarification, without opening the page */}
                  {(() => {
                    const open = (data.spec?.comments ?? []).filter((t) => !t.resolved).length;
                    return open ? (
                      <span title={`${open} offene${open === 1 ? 'r Kommentar' : ' Kommentare'}`}
                        className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${isDark ? 'border-blue-500/30 text-blue-300' : 'border-blue-300 text-blue-700'}`}>
                        <MessageSquare size={9} />{open}
                      </span>
                    ) : null;
                  })()}
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
                {/* the kind of the page - next to the row (a button of its own, not inside the row's button); at least
                    as wide as «User-Task», wider for «×2 ⚠», so the chips stay in one column and do not wrap */}
                <div className="flex-shrink-0 min-w-[5rem] pl-1 flex justify-end">
                  {tasks.length === 0 ? (
                    <span title="Einfache Seite – schliesst keinen Benutzer-Task ab" className={`${chip} ${c.border2} ${c.muted}`}>Seite</span>
                  ) : goal && onOpenTask ? (
                    <button onClick={() => onOpenTask(goal.slug, goal.stepId)} title={`${taskTitle}\n\nKlick: zum Schritt im Prozess`}
                      className={`flex items-center gap-0.5 hover:underline ${chip} ${sky}`}>
                      User-Task{tasks.length > 1 ? ` ×${tasks.length}` : ''}{ambiguous && ' ⚠'}<ArrowUpRight size={9} />
                    </button>
                  ) : (
                    <span title={taskTitle} className={`${chip} ${sky}`}>User-Task{tasks.length > 1 ? ` ×${tasks.length}` : ''}{ambiguous && ' ⚠'}</span>
                  )}
                </div>
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
        }} />
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
