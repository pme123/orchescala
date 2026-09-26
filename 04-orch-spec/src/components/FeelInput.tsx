// Eingabefeld für einen Mapping-Wert mit Pfad-Vervollständigung.
//
// Beginnt der Wert mit `=`, ist er ein FEEL-Ausdruck (Camunda 8). Beim Tippen
// schlägt das Feld die Prozessvariablen und ihre Pfade vor — `client.` zeigt
// die Felder von `client`, `client.addr` filtert darin. Pfeiltasten wählen,
// Enter oder Tab übernimmt, Escape schliesst. Die Prüfung des Ausdrucks
// (Syntax, Pfade, Typ) macht der Aufrufer; hier geht es nur ums Tippen.
import { useEffect, useRef, useState } from 'react';
import { FEEL_TYPE_LABEL, completions, type Completion, type VarNode } from '../feel';
import { cls } from '../ui';

export default function FeelInput({ value, onChange, variables, isDark, disabled, placeholder, title, className }: {
  value: string;
  onChange: (v: string) => void;
  /** Prozessvariablen für die Vorschläge — ohne sie gibt es keine */
  variables: VarNode[] | null;
  isDark: boolean;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
}) {
  const c = cls(isDark);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Completion[]>([]);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [active, setActive] = useState(0);
  const open = !!range && items.length > 0;

  const refresh = (text: string, cursor: number | null) => {
    if (!variables || cursor == null) { setRange(null); return; }
    const r = completions(text, cursor, variables);
    if (!r) { setRange(null); setItems([]); return; }
    setItems(r.items.slice(0, 40));
    setRange({ from: r.from, to: r.to });
    setActive(0);
  };

  const close = () => { setRange(null); setItems([]); };

  const accept = (item: Completion) => {
    if (!range) return;
    const next = value.slice(0, range.from) + item.insert + value.slice(range.to);
    const cursor = range.from + item.insert.length;
    onChange(next);
    close();
    // Cursor hinter das Eingesetzte — die nächste Ebene kommt mit «.»
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  // aktiven Eintrag im Blick halten
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <input ref={inputRef} value={value} disabled={disabled} placeholder={placeholder} title={title}
        onChange={e => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKeyDown}
        onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refresh(value, e.currentTarget.selectionStart); }}
        onClick={e => refresh(value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(close, 120)}
        autoComplete="off" spellCheck={false}
        className={`w-full text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`} />
      {open && (
        <div ref={listRef}
          className={`absolute left-0 right-0 top-full mt-0.5 z-30 max-h-48 overflow-y-auto rounded border shadow-lg ${c.border2} ${c.panelStrong}`}>
          {items.map((it, i) => (
            <button key={it.path} type="button"
              onMouseDown={e => { e.preventDefault(); accept(it); }}
              onMouseEnter={() => setActive(i)}
              title={[it.node.description, `aus ${it.node.source}`].filter(Boolean).join(' — ')}
              className={`w-full text-left px-2 py-1 flex items-baseline gap-2 ${
                i === active ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
              <span className={`text-[10px] font-mono ${c.text}`}>{it.node.name}</span>
              <span className={`text-[9px] font-mono ${c.muted}`}>
                {it.node.label}{it.node.type === 'context' || it.node.type === 'list' ? ' ›' : ''}
              </span>
              <span className={`text-[9px] ml-auto flex-shrink-0 ${c.muted}`}>
                {FEEL_TYPE_LABEL[it.node.type]}{it.node.optional ? ' · optional' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
