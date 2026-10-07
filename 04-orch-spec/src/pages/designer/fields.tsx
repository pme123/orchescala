// Form controls of the page designer - in the style of the panels of orch-spec.
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { cls } from '../../ui';

type Base = { isDark: boolean; label: string; hint?: string };

export function Group({ isDark, title, children, right }: { isDark: boolean; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  const c = cls(isDark);
  return (
    <div className={`border-b px-4 py-3 space-y-2.5 ${c.border}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>{title}</span>
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </div>
  );
}

function Caption({ isDark, label, hint }: Base) {
  const c = cls(isDark);
  return (
    <span className={`block text-[10px] mb-1 ${c.muted2}`} title={hint}>
      {label}
      {hint && <span className={`ml-1 ${c.muted}`}>– {hint}</span>}
    </span>
  );
}

const inputCls = (isDark: boolean, mono?: boolean) =>
  `w-full text-[11px] px-2 py-1.5 rounded border outline-none ${mono ? 'font-mono' : ''} ${cls(isDark).input}`;

export function TextField({ isDark, label, hint, value, onChange, multiline, placeholder, mono }: Base & {
  value: string | undefined; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; mono?: boolean;
}) {
  return (
    <label className="block">
      <Caption isDark={isDark} label={label} hint={hint} />
      {multiline ? (
        <textarea rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls(isDark, mono)} />
      ) : (
        <input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls(isDark, mono)} />
      )}
    </label>
  );
}

/** A path of the state (or a condition) - with the paths the page knows as suggestions. */
export function PathField({ isDark, label, hint, value, onChange, suggestions, placeholder }: Base & {
  value: string | undefined; onChange: (v: string) => void; suggestions: string[]; placeholder?: string;
}) {
  const id = useId();
  return (
    <label className="block">
      <Caption isDark={isDark} label={label} hint={hint} />
      <input list={id} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls(isDark, true)} />
      <datalist id={id}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
    </label>
  );
}

export function SelectField<T extends string>({ isDark, label, hint, value, options, onChange }: Base & {
  value: T | undefined; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <Caption isDark={isDark} label={label} hint={hint} />
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value as T)} className={inputCls(isDark)}>
        {value !== undefined && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function CheckField({ isDark, label, hint, checked, onChange }: Base & { checked: boolean | undefined; onChange: (v: boolean) => void }) {
  const c = cls(isDark);
  return (
    <label className={`flex items-center gap-2 text-[11px] cursor-pointer ${c.muted2}`} title={hint}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A value as JSON - kept as text while it does not parse. */
export function JsonField({ isDark, label, hint, value, onChange, rows = 4 }: Base & { value: unknown; onChange: (v: unknown) => void; rows?: number }) {
  const c = cls(isDark);
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [error, setError] = useState<string | null>(null);
  const shown = value === undefined ? '' : JSON.stringify(value, null, 2);
  // a change from outside (e.g. «vorbelegen») replaces the text
  useEffect(() => {
    try {
      if (text.trim() === '' ? value !== undefined : JSON.stringify(JSON.parse(text)) !== JSON.stringify(value)) setText(shown);
    } catch {
      /* the user is typing */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <label className="block">
      <Caption isDark={isDark} label={label} hint={hint} />
      <textarea rows={rows} value={text} spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
        className={`${inputCls(isDark, true)} ${error ? '!border-rose-500' : ''}`} />
      {error && <span className={`block text-[10px] mt-0.5 ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>{error}</span>}
      {!error && <span className={`block text-[9px] mt-0.5 ${c.muted}`}>JSON – Texte mit {'{{pfad}}'} werden eingesetzt</span>}
    </label>
  );
}

/** A list of rows - add, move, remove. */
export function RowList<T>({ isDark, items, onChange, render, add, addLabel, empty }: {
  isDark: boolean; items: T[]; onChange: (items: T[]) => void; render: (item: T, set: (item: T) => void) => React.ReactNode;
  add: () => T; addLabel: string; empty?: string;
}) {
  const c = cls(isDark);
  const set = (i: number, item: T) => onChange(items.map((x, j) => (j === i ? item : x)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const copy = [...items];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  return (
    <div className="space-y-2">
      {items.length === 0 && empty && <p className={`text-[10px] ${c.muted}`}>{empty}</p>}
      {items.map((item, i) => (
        <div key={i} className={`rounded border p-2 space-y-2 ${c.border2}`}>
          <div className="flex justify-end gap-1 -mb-1">
            <IconButton isDark={isDark} title="nach oben" onClick={() => move(i, -1)}><ArrowUp size={11} /></IconButton>
            <IconButton isDark={isDark} title="nach unten" onClick={() => move(i, 1)}><ArrowDown size={11} /></IconButton>
            <IconButton isDark={isDark} title="entfernen" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={11} /></IconButton>
          </div>
          {render(item, (next) => set(i, next))}
        </div>
      ))}
      <button onClick={() => onChange([...items, add()])}
        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
        <Plus size={10} /> {addLabel}
      </button>
    </div>
  );
}

export function IconButton({ isDark, title, onClick, children, disabled }: {
  isDark: boolean; title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  const c = cls(isDark);
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={`p-1 rounded transition-colors disabled:opacity-30 ${isDark ? 'text-white/40 hover:text-white/80 hover:bg-white/5' : 'text-black/40 hover:text-black/80 hover:bg-black/5'}`}>
      {children}
    </button>
  );
}
