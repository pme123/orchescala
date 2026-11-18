// The In and Out of a mapping: what the script task reads (variables before it, by name) and
// what it sets (variables after it) - each a name and a type. A name of a variable known before
// takes its type; renamed or removed, the lines follow.
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { VarNode } from '../feel';
import { renamedVar } from '../fieldMapping';
import type { Field, FieldMapping, Model, TypeDef } from '../types';
import { cls } from '../ui';
import { uid } from '../util';
import TypePicker from './TypePicker';

export default function MappingInOut({ mapping, known, outFields, types, model, isDark, canEdit, listId, onChange }: {
  mapping: FieldMapping;
  /** what is known before the step - the names the In offers */
  known: VarNode[];
  /** the fields of the process's Out - the names the Out offers */
  outFields: Field[];
  types: TypeDef[];
  model: Model | null;
  isDark: boolean;
  canEdit: boolean;
  listId: string;
  onChange: (m: FieldMapping) => void;
}) {
  const c = cls(isDark);
  const side = (key: 'in' | 'out') => {
    const list = mapping[key];
    const offered: Array<{ name: string; field?: Pick<Field, 'type' | 'collection' | 'optional'> }> = key === 'in'
      ? known.map(v => ({ name: v.name, field: v.field }))
      : outFields.filter(f => f.name).map(f => ({ name: f.name, field: f }));
    const set = (i: number, patch: Partial<Field>) => {
      const old = list[i];
      let next: FieldMapping = { ...mapping, [key]: list.map((f, k) => (k === i ? { ...f, ...patch } : f)) };
      if (patch.name !== undefined && old.name.trim() && patch.name.trim() !== old.name.trim()) {
        next = renamedVar(next, key, old.name.trim(), patch.name.trim() || null);
      }
      onChange(next);
    };
    const rename = (i: number, name: string) => {
      const f = list[i];
      // a variable known by that name: its type, as long as none is chosen
      const hit = offered.find(o => o.name === name.trim())?.field;
      set(i, hit && !f.type ? { name, type: hit.type, collection: hit.collection || undefined, optional: hit.optional || undefined } : { name });
    };
    const remove = (i: number) => {
      const f = list[i];
      const rest: FieldMapping = { ...mapping, [key]: list.filter((_, k) => k !== i) };
      onChange(f.name.trim() ? renamedVar(rest, key, f.name.trim(), null) : rest);
    };
    const add = () => {
      // the next variable known that is not in it yet
      const used = new Set(list.map(f => f.name.trim()));
      const next = offered.find(o => !used.has(o.name) && o.field);
      const f: Field = next ? { id: uid('f'), name: next.name, type: next.field!.type, ...(next.field!.collection ? { collection: true } : {}), ...(next.field!.optional ? { optional: true } : {}) } : { id: uid('f'), name: '', type: '' };
      onChange({ ...mapping, [key]: [...list, f] });
    };
    const dl = `${listId}-${key}`;
    return (
      <div className="flex items-start gap-2 text-[10px]">
        <span className={`${c.muted} w-24 flex-shrink-0 pt-1`} title={key === 'in' ? 'Was der Schritt liest - Variablen vor ihm, mit ihrem Namen' : 'Was der Schritt setzt - Variablen nach ihm, mit ihrem Namen'}>
          {key === 'in' ? 'In' : 'Out'}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          {list.map((f, i) => (
            <div key={f.id} className="flex items-center gap-1">
              <NameInput name={f.name} disabled={!canEdit} list={dl} isDark={isDark} input={c.input}
                taken={n => list.some((o, k) => k !== i && o.name.trim() === n)}
                placeholder={key === 'in' ? 'Variable davor' : 'Variable danach'} onCommit={n => rename(i, n)} />
              <TypePicker value={f.type} types={types} selfId="" model={model} isDark={isDark} disabled={!canEdit}
                onPick={v => set(i, { type: v })} className="flex-1 min-w-0" />
              <label className={`flex items-center gap-0.5 flex-shrink-0 ${c.muted}`} title="Eine Liste dieses Typs (Seq[…])">
                <input type="checkbox" checked={!!f.collection} disabled={!canEdit} onChange={e => set(i, { collection: e.target.checked || undefined })} /> Liste
              </label>
              <label className={`flex items-center gap-0.5 flex-shrink-0 ${c.muted}`} title="Kann fehlen (Option[…])">
                <input type="checkbox" checked={!!f.optional} disabled={!canEdit} onChange={e => set(i, { optional: e.target.checked || undefined })} /> opt.
              </label>
              {canEdit && (
                <button type="button" onClick={() => remove(i)} className={`p-0.5 flex-shrink-0 ${c.muted} hover:text-rose-500`} aria-label="Entfernen" title="Entfernen - seine Linien auch">
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button type="button" onClick={add} className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${c.btn}`}>
              <Plus size={10} /> Variable
            </button>
          )}
          <datalist id={dl}>{offered.map(o => <option key={o.name} value={o.name} />)}</datalist>
        </div>
      </div>
    );
  };
  return <>{side('in')}{side('out')}</>;
}

/**
 * The name of a variable - renamed when it is left (or with Enter), not with every key: its lines
 * move once. A name another variable of the side has is not taken - the lines would merge.
 */
function NameInput({ name, taken, onCommit, disabled, list, placeholder, isDark, input }: {
  name: string; taken: (n: string) => boolean; onCommit: (n: string) => void;
  disabled: boolean; list: string; placeholder: string; isDark: boolean; input: string;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const clash = !!draft.trim() && draft.trim() !== name.trim() && taken(draft.trim());
  const commit = () => {
    if (clash) setDraft(name);
    else if (draft !== name) onCommit(draft);
  };
  const bad = clash || !draft.trim();
  return (
    <input value={draft} disabled={disabled} list={list} placeholder={placeholder}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(name); }}
      title={clash ? `«${draft.trim()}» gibt es schon - beim Verlassen bleibt «${name}»` : undefined}
      className={`w-32 min-w-0 text-[10px] px-1.5 py-1 rounded border outline-none font-mono ${input} ${bad ? (isDark ? 'border-rose-500/60' : 'border-rose-400') : ''}`} />
  );
}
