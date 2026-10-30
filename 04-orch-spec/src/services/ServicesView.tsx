// The services next to the processes — one file per collection in `services/`.
//
// A **service collection** is one REST API of a service project: its
// operations (from an OpenAPI, ticked one by one), each with `In`/`Out` for the
// process and the mappings to the request and from the response. The export
// creates one ServiceTask per operation and its ServiceWorker.
//
// Same head as the other lists (search, epics, groups per project); deleting
// only with the admin role or without mandatory login, as for processes.
import { AlertTriangle, Boxes, Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usePermissions } from '../auth';
import { useConfirm } from '../components/Confirm';
import { ProjectGroups, SpecListHead, useSpecList, type ListEntry } from '../components/SpecList';
import { epicsOf } from '../epics';
import { useStore } from '../store';
import { EpicChip, StatusChip, cls } from '../ui';
import { API_NAME, PROJECT_NAME, collectionPackage, collectionSlug, collectionStatus, newCollection, topicPrefix } from './collection';
import { useServices, type ServiceListItem } from './store';

const serviceEntry = ({ slug, data }: ServiceListItem): ListEntry => ({
  title: data.title,
  terms: [slug, data.api, topicPrefix(data), ...data.services.map(s => `${s.name} ${s.method} ${s.path}`)],
  project: data.project, epics: data.epics, updatedAt: data.updatedAt,
});

export default function ServicesView({ onOpen }: { onOpen: (slug: string) => void }) {
  const { isDark, model } = useStore();
  const { services, servicesLoading, servicesUnreadable, createService, deleteService } = useServices();
  const { canEdit, canDelete } = usePermissions();
  const confirm = useConfirm();
  const c = cls(isDark);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const list = useSpecList(services, serviceEntry, model);

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-1">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Services</h1>
        {canEdit && (
          <button onClick={() => setCreating(true)}
            className={`ml-auto flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-transparent ${c.btnPrimary}`}>
            <Plus size={12} /> Neue Collection
          </button>
        )}
      </div>
      <p className={`text-[11px] mb-4 ${c.muted}`}>
        Eine <b>Service Collection</b> ist eine REST-API eines Service-Projekts: die Operationen aus der OpenAPI wählen,
        je Service <span className="font-mono">In</span> und <span className="font-mono">Out</span> ergänzen und die Mappings
        festlegen. Daraus entstehen ServiceTasks und ServiceWorker.
      </p>

      {creating && (
        <NewCollection existing={services.map(s => s.slug)} onClose={() => setCreating(false)}
          onCreate={async input => {
            const spec = newCollection(input);
            const r = await createService(spec);
            if (r.ok) { setCreating(false); onOpen(spec.slug); }
            return r;
          }} />
      )}

      {services.length > 0 && <SpecListHead isDark={isDark} list={list} placeholder="Titel, Projekt, Service, Pfad …" noun="Services" />}
      {deleteError && <p className="mb-2 text-[11px] text-rose-500">{deleteError}</p>}
      {servicesUnreadable.length > 0 && (
        <div className={`mb-3 rounded border p-2.5 space-y-1 ${isDark ? 'border-rose-500/30 bg-rose-500/10' : 'border-rose-300 bg-rose-50'}`}>
          {servicesUnreadable.map(u => (
            <div key={u.file} className="flex items-start gap-1.5 text-[11px] text-rose-500">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span><span className="font-mono">services/{u.file}</span> ist nicht lesbar – {u.problem}.</span>
            </div>
          ))}
        </div>
      )}

      {servicesLoading ? (
        <div className={`text-xs ${c.muted} py-10 text-center flex items-center justify-center gap-2`}><Loader2 size={12} className="animate-spin" /> Lade Services …</div>
      ) : services.length === 0 ? (
        <div className={`rounded border p-6 text-center ${c.border2}`}>
          <Boxes size={20} className={`mx-auto mb-2 ${c.muted}`} />
          <p className={`text-xs ${c.muted2}`}>Noch keine Services – «Neue Collection» legt die erste an (<span className="font-mono">services/</span>).</p>
        </div>
      ) : !list.visible.length ? (
        <div className={`text-xs ${c.muted} py-10 text-center`}>
          Keine Collection passt zu Suche und Filter.
          <button onClick={list.reset} className="ml-1.5 hover:underline">Filter aus</button>
        </div>
      ) : (
        <ProjectGroups isDark={isDark} groups={list.groups} noun={['Collection', 'Collections']} render={({ slug, data, version }) => {
          const open = (data.comments ?? []).filter(t => !t.resolved).length;
          return (
            <div key={slug} className={`rounded border ${c.border2} ${c.hover} flex items-center`}>
              <button onClick={() => onOpen(slug)} className="min-w-0 flex-1 text-left px-3 py-2.5 flex items-center gap-3">
                <Boxes size={14} className={isDark ? 'text-teal-300' : 'text-teal-700'} />
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-semibold truncate ${c.text}`}>{data.title || slug}</div>
                  <div className={`text-[10px] font-mono truncate ${c.muted}`}>{collectionPackage(data)}</div>
                </div>
                {epicsOf({ epics: data.epics }, model).map(e => <EpicChip key={e.id} name={e.name} closed={e.closed} isDark={isDark} />)}
                <span className={`hidden sm:inline text-[9px] ${c.muted}`}>{data.services.length} Service{data.services.length === 1 ? '' : 's'}</span>
                {open > 0 && (
                  <span title={`${open} offene${open === 1 ? 'r Kommentar' : ' Kommentare'}`}
                    className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${isDark ? 'border-blue-500/30 text-blue-300' : 'border-blue-300 text-blue-700'}`}>
                    <MessageSquare size={9} />{open}
                  </span>
                )}
                <StatusChip status={collectionStatus(data)} isDark={isDark} title="tiefster Status der Services" />
              </button>
              {canDelete && (
                <button title="Collection löschen"
                  onClick={async () => {
                    if (!(await confirm({ title: `Collection «${data.title || slug}» löschen?` }))) return;
                    const r = await deleteService(slug, version);
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

function NewCollection({ existing, onCreate, onClose }: {
  existing: string[];
  onCreate: (input: { title: string; project: string; api: string; apiVersion: number }) => Promise<{ ok: true } | { ok: false; message: string }>;
  onClose: () => void;
}) {
  const { isDark, model } = useStore();
  const c = cls(isDark);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [api, setApi] = useState('');
  const [apiVersion, setApiVersion] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // the projects of the catalog as suggestions — the services usually belong to an existing one
  const projects = [...new Set((model?.projects ?? []).map(p => p.name).filter(Boolean))] as string[];
  const input = { title: title.trim(), project: project.trim(), api: api.trim(), apiVersion };
  const slug = collectionSlug(input);
  const taken = existing.includes(slug);
  const problem = !input.title ? 'Titel fehlt'
    : !PROJECT_NAME.test(input.project) ? 'Projekt: Kleinbuchstaben mit «-», z. B. acme-crm'
      : !API_NAME.test(input.api) ? 'API: ein Name in camelCase, z. B. client'
        : apiVersion < 1 ? 'Version ab 1'
          : taken ? `services/${slug}.json gibt es schon` : '';
  const field = `w-full px-2 py-1 rounded border bg-transparent text-[11px] outline-none ${c.border2} ${c.text}`;
  return (
    <div className={`mb-4 p-3 rounded border space-y-2 ${c.border2} ${c.panel}`}>
      <div className="grid grid-cols-[2fr_1.5fr_1fr_4rem] gap-2">
        <label className="space-y-0.5">
          <span className={`text-[10px] ${c.muted}`}>Titel</span>
          <input className={field} value={title} onChange={e => setTitle(e.target.value)} placeholder="Kunden-API" autoFocus />
        </label>
        <label className="space-y-0.5">
          <span className={`text-[10px] ${c.muted}`}>Projekt</span>
          <input className={`${field} font-mono`} value={project} onChange={e => setProject(e.target.value)} placeholder="acme-crm" list="service-projects" />
          <datalist id="service-projects">{projects.map(p => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="space-y-0.5">
          <span className={`text-[10px] ${c.muted}`}>API</span>
          <input className={`${field} font-mono`} value={api} onChange={e => setApi(e.target.value)} placeholder="client" />
        </label>
        <label className="space-y-0.5">
          <span className={`text-[10px] ${c.muted}`}>Version</span>
          <input className={`${field} font-mono`} type="number" min={1} value={apiVersion} onChange={e => setApiVersion(Math.max(1, Number(e.target.value) || 1))} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-mono ${problem && input.title ? 'text-rose-500' : c.muted}`}>
          {problem && (input.title || input.project || input.api) ? problem
            : input.project && input.api ? `${collectionPackage(input)} · Topics ${topicPrefix(input)}.…` : 'Paket und Topics folgen aus Projekt, API und Version'}
        </span>
        {error && <span className="text-[10px] text-rose-500">{error}</span>}
        <button onClick={onClose} className={`ml-auto text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
        <button disabled={!!problem || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await onCreate(input);
              if (!r.ok) setError(r.message);
            } finally { setBusy(false); }
          }}
          className={`text-[11px] px-2.5 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
          Anlegen
        </button>
      </div>
    </div>
  );
}
