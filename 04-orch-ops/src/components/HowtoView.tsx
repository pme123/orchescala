// How-to infos for operations — the section «Wiki mit How-to Infos» of the
// Confluence page. A Markdown text in the model.json.
import { useState } from 'react';
import { Check, Eye, Pencil } from 'lucide-react';
import { useStore } from '../store';
import { usePermissions } from '../auth';
import { Markdown } from '../markdown';
import { cls } from '../ui';

export default function HowtoView() {
  const { isDark, model, saveModel } = useStore();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [text, setText] = useState(model?.howto ?? '');
  const [msg, setMsg] = useState('');
  if (!model) return null;

  const save = async () => {
    const r = await saveModel({ ...model, howto: text });
    if (r.ok) { setEditing(false); setMsg(''); } else setMsg(r.message);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <div className="flex items-center gap-2 mb-4">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>How-to für den Betrieb</h1>
        <div className="ml-auto flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={() => setPreview(p => !p)}
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${preview ? (isDark ? 'border-white/40 text-white' : 'border-black/40 text-black') : c.btn}`}>
                <Eye size={12} /> Vorschau
              </button>
              <button onClick={() => { setEditing(false); setText(model.howto ?? ''); }} className={`text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
              <button onClick={() => void save()} className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded font-semibold ${c.btnPrimary}`}>
                <Check size={12} /> Speichern
              </button>
            </>
          ) : canEdit && (
            <button onClick={() => { setText(model.howto ?? ''); setEditing(true); setPreview(false); }}
              className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
              <Pencil size={12} /> Bearbeiten
            </button>
          )}
        </div>
      </div>
      <div className={`rounded-lg border p-5 ${c.border2} ${isDark ? 'bg-[#141518]' : 'bg-white'}`}>
        {editing && !preview ? (
          <textarea value={text} onChange={e => setText(e.target.value)} autoFocus rows={16}
            placeholder={'- Laufender Prozess mutieren: Runtime > Modify > …\n- …'}
            className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none grow font-mono ${c.input}`} />
        ) : (editing ? text : model.howto)?.trim() ? (
          <div className="text-[12px]"><Markdown text={editing ? text : model.howto ?? ''} /></div>
        ) : (
          <p className={`text-[11px] ${c.muted}`}>Noch keine How-to-Infos.{canEdit && ' «Bearbeiten» oben rechts.'}</p>
        )}
        {msg && <p className={`text-[11px] mt-2 ${c.error}`}>{msg}</p>}
      </div>
    </div>
  );
}
