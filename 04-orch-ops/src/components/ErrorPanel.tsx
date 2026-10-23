// One error in detail — view, edit, create.
//
// Appears as a drawer on the right above the list; the list stays behind it.
// While creating, the app checks whether the error already exists (the page
// documents «from the 2nd occurrence») — then counting instead of creating a
// duplicate is one click away.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Check, Code2, Copy, Eye, ImagePlus, Loader2, Pencil, Tally5, X } from 'lucide-react';
import { useStore, type ErrorItem } from '../store';
import { usePermissions } from '../auth';
import { StatusTag, cls } from '../ui';
import { Markdown } from '../markdown';
import { similar } from '../search';
import { imageMarkdown, isImageFile } from '../attachments';
import { fmtRelative, fmtTimestamp } from '../util';
import CountButton from './CountButton';
import type { ErrorEntry } from '../types';

type Draft = Pick<ErrorEntry, 'process' | 'title' | 'details' | 'activity' | 'reporter' | 'status' | 'ticket' | 'workaround' | 'count'>;

const EMPTY: Draft = { process: '', title: '', details: '', activity: '', reporter: '', status: [], ticket: '', workaround: '', count: 1 };

const pick = (e: ErrorEntry): Draft => ({
  process: e.process, title: e.title, details: e.details, activity: e.activity,
  reporter: e.reporter, status: e.status, ticket: e.ticket, workaround: e.workaround, count: e.count,
});

export default function ErrorPanel({ id, isNew, onClose, onOpen }: {
  id: string | null;
  isNew: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { isDark, errors, model, actor, createError, saveError, countError, saveAttachment } = useStore();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const item = id ? errors.find(e => e.data.id === id) ?? null : null;
  // new: reporter = who is working, status = the first one (OFFEN)
  const firstStatus = model?.statuses[0]?.label;
  const fresh = (): Draft => ({ ...EMPTY, reporter: actor, status: firstStatus ? [firstStatus] : [] });
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState<Draft>(() => (item ? pick(item.data) : fresh()));
  const [baseVersion, setBaseVersion] = useState(item?.version ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [conflict, setConflict] = useState<ErrorItem | null>(null);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  // images: text fields (for the cursor position), running upload per field
  const areaRefs = useRef<Partial<Record<'details' | 'workaround', HTMLTextAreaElement | null>>>({});
  const fileRefs = useRef<Partial<Record<'details' | 'workaround', HTMLInputElement | null>>>({});
  const [uploading, setUploading] = useState<'details' | 'workaround' | null>(null);
  const [dragOver, setDragOver] = useState<'details' | 'workaround' | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // another error selected → reset the form
  useEffect(() => {
    setEditing(isNew);
    setDraft(item ? pick(item.data) : fresh());
    setBaseVersion(item?.version ?? '');
    setMsg(''); setConflict(null); setPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // Esc closes (while editing only if nothing has changed)
  const dirty = editing && (isNew ? JSON.stringify(draft) !== JSON.stringify(fresh()) : !!item && JSON.stringify(draft) !== JSON.stringify(pick(item.data)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dirty) return;
      if (editing && !isNew) setEditing(false); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, editing, isNew, onClose]);

  const all = useMemo(() => errors.map(e => e.data), [errors]);
  const processes = useMemo(() => [...new Set(all.map(e => e.process).filter(Boolean))].sort(), [all]);
  const activities = useMemo(() => [...new Set(all.filter(e => !draft.process || e.process === draft.process).map(e => e.activity).filter(Boolean))].sort(), [all, draft.process]);
  const dupes = useMemo(() => (isNew && (draft.title.length > 3 || draft.details.length > 10) ? similar(draft, all) : []), [isNew, draft, all]);

  const statuses = model?.statuses ?? [];
  const statusOptions = [...statuses.map(s => s.label), ...draft.status.filter(s => !statuses.some(x => x.label === s))];

  if (!isNew && !item) {
    return (
      <Drawer isDark={isDark} onClose={onClose}>
        <p className={`text-[11px] ${c.muted}`}>Dieser Fehler existiert nicht (mehr) im Ordner.</p>
      </Drawer>
    );
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  const save = async (force = false) => {
    if (!draft.title.trim() && !draft.details.trim()) { setMsg('Bitte mindestens einen Kurzbeschrieb angeben.'); return; }
    setBusy(true); setMsg('');
    const clean: Draft = {
      ...draft, process: draft.process.trim(), title: draft.title.trim(), activity: draft.activity.trim(), reporter: draft.reporter.trim(),
      // set directly (e.g. a known count after the import) — a whole number ≥ 0
      count: Math.max(0, Math.floor(Number.isFinite(draft.count) ? draft.count : 0)),
    };
    if (isNew) {
      const r = await createError(clean);
      setBusy(false);
      if (r.ok) onOpen(r.item.data.id);
      else setMsg(r.message);
      return;
    }
    const version = force && conflict ? conflict.version : baseVersion;
    const base = force && conflict ? conflict.data : item!.data;
    const r = await saveError({ ...base, ...clean }, version);
    setBusy(false);
    if (r.status === 'saved') { setEditing(false); setConflict(null); setBaseVersion(r.item.version); }
    else if (r.status === 'conflict') setConflict(r.current);
    else setMsg(r.message);
  };

  const setArchived = async (archived: boolean) => {
    if (!item) return;
    setBusy(true);
    const r = await saveError({ ...item.data, archived }, item.version);
    setBusy(false);
    if (r.status === 'saved') { if (archived) onClose(); }
    else setMsg(r.status === 'conflict' ? 'Inzwischen geändert — bitte nochmals versuchen.' : r.message);
  };

  // save images and insert the reference at the cursor position
  const addImages = async (k: 'details' | 'workaround', files: File[]) => {
    const imgs = files.filter(isImageFile);
    if (!imgs.length) { if (files.length) setMsg('Nur Bilder (PNG, JPEG, GIF, WebP).'); return; }
    const area = areaRefs.current[k];
    let pos = area ? area.selectionEnd : draft[k].length;
    setUploading(k); setMsg('');
    for (const f of imgs) {
      const r = await saveAttachment(f);
      if (!r.ok) { setMsg(r.message); break; }
      const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.\w+$/, '') : 'Screenshot';
      // current text (after the await it has re-rendered)
      const t = draftRef.current[k];
      const at = Math.min(pos, t.length);
      const before = t.slice(0, at), after = t.slice(at);
      const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const inserted = `${lead}${imageMarkdown(r.path, name)}\n${after && !after.startsWith('\n') ? '\n' : ''}`;
      const next = before + inserted + after;
      draftRef.current = { ...draftRef.current, [k]: next };
      setDraft(d => ({ ...d, [k]: next }));
      pos = at + inserted.length;
    }
    setUploading(null);
    requestAnimationFrame(() => { const a = areaRefs.current[k]; if (a) { a.focus(); a.setSelectionRange(pos, pos); } });
  };

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const countInstead = async (other: string) => {
    const r = await countError(other);
    if (r.ok) onOpen(other); else setMsg(r.message);
  };

  // ── view ────────────────────────────────────────────────────────────────
  if (!editing && item) {
    const e = item.data;
    const occ = e.occurrences ?? [];
    return (
      <Drawer isDark={isDark} onClose={onClose}
        actions={<>
          <button onClick={copyLink} title="Link auf diesen Fehler kopieren" className={`p-1.5 rounded border ${c.btn}`}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {canEdit && (
            <button onClick={() => void setArchived(!e.archived)} disabled={busy}
              title={e.archived ? 'Wieder in die Liste aufnehmen' : 'Aus der Liste nehmen (bleibt im Archiv erhalten)'}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              {e.archived ? <><ArchiveRestore size={12} /> Wiederherstellen</> : <><Archive size={12} /> Archivieren</>}
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setDraft(pick(e)); setBaseVersion(item.version); setEditing(true); }}
              className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded font-semibold ${c.btnPrimary}`}>
              <Pencil size={12} /> Bearbeiten
            </button>
          )}
        </>}>
        <div className="flex gap-4 items-start">
          <CountButton id={e.id} count={e.count} size="lg" />
          <div className="min-w-0 flex-1">
            <div className={`text-[11px] font-semibold ${c.muted2}`}>{e.process || '—'}</div>
            <h2 className={`text-[15px] font-semibold leading-snug mt-0.5 ${c.text}`}>{e.title || '(ohne Kurzbeschrieb)'}</h2>
            <div className="flex gap-1 flex-wrap mt-2">
              {e.status.map(s => <StatusTag key={s} label={s} statuses={statuses} isDark={isDark} />)}
              {e.archived && <span className={`text-[9px] px-1.5 py-0.5 rounded border ${c.border2} ${c.muted}`}>ARCHIVIERT</span>}
            </div>
          </div>
        </div>

        <dl className={`grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 mt-5 text-[11px]`}>
          <Dt c={c}>Aktivität</Dt><dd className={c.text}>{e.activity || <span className={c.muted}>—</span>}</dd>
          <Dt c={c}>Erfasser</Dt><dd className={c.text}>{e.reporter || <span className={c.muted}>—</span>}</dd>
          <Dt c={c}>Ticket</Dt><dd>{e.ticket.trim() ? <Markdown text={e.ticket} /> : <span className={c.muted}>—</span>}</dd>
        </dl>

        <Section title="Kommentar / Workaround" c={c}>
          {e.workaround.trim() ? <Markdown text={e.workaround} /> : <Empty c={c} />}
        </Section>
        <Section title="Details / Incident" c={c}>
          {e.details.trim() ? <Markdown text={e.details} /> : <Empty c={c} />}
        </Section>

        <Section title="Verlauf" c={c}>
          <ul className={`text-[11px] space-y-1 ${c.muted2}`}>
            <li>Letztes Update: <span className={c.text}>{fmtTimestamp(e.updatedAt)}</span>
              {e.updatedBy && <> · {e.updatedBy}</>} <span className={c.muted}>({fmtRelative(e.updatedAt)})</span></li>
            <li>Erfasst: {fmtTimestamp(e.createdAt)}{e.createdBy && <> · {e.createdBy}</>}</li>
          </ul>
          {occ.length > 0 && (
            <div className="mt-3">
              <div className={`text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>
                Gezählt {occ.length < e.count && <span className="normal-case tracking-normal">· {occ.length} von {e.count} mit Zeitpunkt</span>}
              </div>
              <ul className={`text-[11px] space-y-0.5 ${c.muted2}`}>
                {occ.slice(0, 12).map((o, i) => (
                  <li key={i} className="flex items-center gap-2"><Tally5 size={10} className={c.muted} />{fmtTimestamp(o.at)}{o.by && <span className={c.muted}>· {o.by}</span>}</li>
                ))}
                {occ.length > 12 && <li className={c.muted}>… und {occ.length - 12} weitere</li>}
              </ul>
            </div>
          )}
          <p className={`text-[10px] mt-3 font-mono ${c.muted}`}>errors/{e.id}.json</p>
        </Section>
        {msg && <p className={`text-[11px] mt-3 ${c.error}`}>{msg}</p>}
      </Drawer>
    );
  }

  // ── edit / new ──────────────────────────────────────────────────────────
  const field = `w-full text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`;
  const mdArea = (k: 'details' | 'workaround' | 'ticket', rows: number, placeholder: string, mono = false) => {
    if (preview) return <div className={`rounded border px-2 py-1.5 min-h-[2.2rem] ${c.border2}`}>{draft[k].trim() ? <Markdown text={draft[k]} /> : <Empty c={c} />}</div>;
    if (k === 'ticket') return (
      <textarea value={draft[k]} onChange={ev => set(k, ev.target.value)} rows={rows} placeholder={placeholder}
        className={`${field} grow resize-y`} />
    );
    // details and workaround take images: paste (⌘V), drag in, button
    return (
      <div className="relative">
        <textarea ref={el => { areaRefs.current[k] = el; }} value={draft[k]} onChange={ev => set(k, ev.target.value)}
          rows={rows} placeholder={placeholder}
          onPaste={ev => {
            const files = [...ev.clipboardData.files].filter(isImageFile);
            if (files.length) { ev.preventDefault(); void addImages(k, files); }
          }}
          onDragOver={ev => { if (ev.dataTransfer.types.includes('Files')) { ev.preventDefault(); setDragOver(k); } }}
          onDragLeave={() => setDragOver(null)}
          onDrop={ev => {
            if (!ev.dataTransfer.files.length) return;
            ev.preventDefault(); setDragOver(null);
            void addImages(k, [...ev.dataTransfer.files]);
          }}
          className={`${field} grow resize-y ${mono ? 'font-mono text-[10.5px]' : ''} ${dragOver === k ? (isDark ? 'border-sky-400/70 bg-sky-400/10' : 'border-sky-500 bg-sky-50') : ''}`} />
        {uploading === k && (
          <div className={`absolute right-2 bottom-2 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-black/60 text-white/70' : 'bg-white/90 text-black/60'}`}>
            <Loader2 size={10} className="animate-spin" /> Bild wird gespeichert …
          </div>
        )}
        <input ref={el => { fileRefs.current[k] = el; }} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden"
          onChange={ev => { const f = [...(ev.target.files ?? [])]; ev.target.value = ''; if (f.length) void addImages(k, f); }} />
      </div>
    );
  };
  const imageButton = (k: 'details' | 'workaround') => !preview && (
    <button onClick={() => fileRefs.current[k]?.click()} disabled={!!uploading}
      title="Bild anhängen — oder Screenshot mit ⌘V einfügen bzw. ins Feld ziehen"
      className={`flex items-center gap-1 text-[10px] hover:underline disabled:opacity-50 ${c.muted}`}><ImagePlus size={10} /> Bild</button>
  );

  return (
    <Drawer isDark={isDark} onClose={() => { if (!dirty || confirm('Änderungen verwerfen?')) onClose(); }}
      title={isNew ? 'Neuer Fehler' : 'Fehler bearbeiten'}
      actions={<>
        <button onClick={() => setPreview(p => !p)} title="Markdown-Vorschau"
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${preview ? (isDark ? 'border-white/40 text-white' : 'border-black/40 text-black') : c.btn}`}>
          <Eye size={12} /> Vorschau
        </button>
        <button onClick={() => { if (isNew) onClose(); else { setEditing(false); setConflict(null); } }}
          className={`text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
        <button onClick={() => void save()} disabled={busy}
          className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-50 ${c.btnPrimary}`}>
          <Check size={12} /> {busy ? 'Speichere …' : isNew ? 'Erfassen' : 'Speichern'}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <L c={c} label="Prozess">
            <input value={draft.process} onChange={ev => set('process', ev.target.value)} list="oo-processes" autoFocus={isNew}
              placeholder="z. B. acme-onboarding-onboardingV2" className={`${field} font-mono`} />
            <datalist id="oo-processes">{processes.map(p => <option key={p} value={p} />)}</datalist>
          </L>
          <L c={c} label="Aktivität">
            <input value={draft.activity} onChange={ev => set('activity', ev.target.value)} list="oo-activities"
              placeholder="Schritt im Prozess, z. B. Post Account" className={field} />
            <datalist id="oo-activities">{activities.map(a => <option key={a} value={a} />)}</datalist>
          </L>
        </div>
        <L c={c} label="Kurzbeschrieb">
          <input value={draft.title} onChange={ev => set('title', ev.target.value)}
            placeholder="Was passiert? Eine Zeile, z. B. «Kundensegment nicht zugeteilt»" className={`${field} font-semibold`} />
        </L>

        {dupes.length > 0 && (
          <div className={`rounded border p-3 ${isDark ? 'border-amber-500/40 bg-amber-500/5' : 'border-amber-300 bg-amber-50'}`}>
            <p className={`text-[11px] mb-2 ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
              Gibt es den schon? Dann besser zählen statt doppelt erfassen:
            </p>
            <ul className="space-y-1.5">
              {dupes.map(({ e }) => (
                <li key={e.id} className="flex items-center gap-2 text-[11px]">
                  <button onClick={() => void countInstead(e.id)} title="Diesen Fehler +1 zählen und öffnen"
                    className={`flex items-center gap-1 px-2 py-1 rounded border flex-shrink-0 ${c.btn}`}>
                    <Tally5 size={11} /> +1 <span className="tabular-nums opacity-60">({e.count})</span>
                  </button>
                  <button onClick={() => onOpen(e.id)} className={`text-left truncate hover:underline ${c.text}`}>
                    {e.title} <span className={c.muted}>· {e.process}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <L c={c} label="Status">
          <div className="flex gap-1.5 flex-wrap">
            {statusOptions.map(s => (
              <StatusTag key={s} label={s} statuses={statuses} isDark={isDark} active={draft.status.includes(s)}
                onClick={() => set('status', draft.status.includes(s) ? draft.status.filter(x => x !== s) : [...draft.status, s])} />
            ))}
          </div>
        </L>
        <div className="grid grid-cols-[1fr_1fr_6.5rem] gap-3">
          <L c={c} label="Erfasser">
            <input value={draft.reporter} onChange={ev => set('reporter', ev.target.value)} placeholder="Name" className={field} />
          </L>
          <L c={c} label="Ticket">
            {mdArea('ticket', 1, 'OPS-123 oder Link, z. B. [OPS-123](https://…)')}
          </L>
          <L c={c} label="Count">
            <input type="number" min={0} step={1} value={Number.isFinite(draft.count) ? draft.count : ''}
              onChange={ev => set('count', ev.target.value === '' ? NaN : Number(ev.target.value))}
              title={isNew ? 'Wie oft ist er schon aufgetreten?' : 'Direkt setzen — z. B. eine bekannte Anzahl nachtragen. Sonst zählt der +1-Knopf.'}
              className={`${field} tabular-nums`} />
          </L>
        </div>
        <L c={c} label="Kommentar / Workaround" hint="Markdown · Screenshot mit ⌘V einfügen" extra={imageButton('workaround')}>
          {mdArea('workaround', 4, 'Was tun, wenn er wieder auftritt? Schritte, Variablen, Retry …')}
        </L>
        <L c={c} label="Details / Incident" hint="Fehlermeldung, Log, Request, Screenshot"
          extra={<span className="flex items-center gap-3">
            {!preview && draft.details.trim() && !/```|~~~~|!\[/.test(draft.details) && (
              <button onClick={() => set('details', `\`\`\`\n${draft.details.trim()}\n\`\`\``)}
                className={`flex items-center gap-1 text-[10px] hover:underline ${c.muted}`}><Code2 size={10} /> als Codeblock</button>
            )}
            {imageButton('details')}
          </span>}>
          {mdArea('details', 6, 'Incident-Meldung aus Camunda hier einfügen …', true)}
        </L>

        {conflict && (
          <div className={`rounded border p-3 text-[11px] ${isDark ? 'border-rose-500/40 bg-rose-500/5 text-rose-200' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
            <p>Inzwischen hat {conflict.data.updatedBy || 'jemand anders'} diesen Fehler geändert ({fmtRelative(conflict.data.updatedAt)}).
              Deine Änderungen sind noch hier im Formular.</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setDraft(pick(conflict.data)); setBaseVersion(conflict.version); setConflict(null); }}
                className={`px-2.5 py-1 rounded border ${c.btn}`}>Meine verwerfen, neuen Stand laden</button>
              <button onClick={() => void save(true)} className={`px-2.5 py-1 rounded border ${c.btn}`}>Trotzdem mit meinen überschreiben</button>
            </div>
          </div>
        )}
        {msg && <p className={`text-[11px] ${c.error}`}>{msg}</p>}
      </div>
    </Drawer>
  );
}

// ── small building blocks ─────────────────────────────────────────────────
type C = ReturnType<typeof cls>;

function Drawer({ isDark, onClose, title, actions, children }: {
  isDark: boolean; onClose: () => void; title?: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  const c = cls(isDark);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`h-full w-full max-w-3xl flex flex-col border-l shadow-2xl ${c.border2} ${isDark ? 'bg-[#121316]' : 'bg-[#fbfaf7]'}`}>
        <div className={`flex items-center gap-2 px-5 py-2.5 border-b flex-shrink-0 ${c.border} ${c.top}`}>
          <span className={`text-[11px] font-semibold uppercase tracking-widest ${c.muted2}`}>{title ?? 'Fehler'}</span>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
          <button onClick={onClose} title="Schliessen (Esc)" className={`p-1 ml-1 rounded ${c.muted} hover:opacity-70`}><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, c, children }: { title: string; c: C; children: React.ReactNode }) {
  return (
    <section className={`mt-5 pt-4 border-t ${c.border}`}>
      <h3 className={`text-[10px] uppercase tracking-widest mb-2 ${c.muted}`}>{title}</h3>
      {children}
    </section>
  );
}

function Dt({ c, children }: { c: C; children: React.ReactNode }) {
  return <dt className={`text-[10px] uppercase tracking-wider pt-0.5 ${c.muted}`}>{children}</dt>;
}

function Empty({ c }: { c: C }) {
  return <span className={`text-[11px] ${c.muted}`}>—</span>;
}

function L({ c, label, hint, extra, children }: { c: C; label: string; hint?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className={`block text-[10px] uppercase tracking-wider ${c.muted}`}>{label}</label>
        {hint && <span className={`text-[10px] ${c.muted} opacity-70`}>{hint}</span>}
        {extra && <span className="ml-auto">{extra}</span>}
      </div>
      {children}
    </div>
  );
}
