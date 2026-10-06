// Eingabefeld für einen Mapping-Wert mit Pfad-Vervollständigung.
//
// Beginnt der Wert mit `=`, ist er ein FEEL-Ausdruck (Camunda 8). Beim Tippen
// schlägt das Feld die Prozessvariablen und ihre Pfade vor — `client.` zeigt
// die Felder von `client`, `client.addr` filtert darin. Pfeiltasten wählen,
// Enter oder Tab übernimmt, Escape schliesst. Die Prüfung des Ausdrucks
// (Syntax, Pfade, Typ) macht der Aufrufer; hier geht es nur ums Tippen.
import { useEffect, useRef, useState } from 'react';
import { FEEL_TYPE_LABEL, completions, isFeel, tokenizeFeel, type Completion, type FeelTokenKind, type VarNode } from '../feel';
import { cls } from '../ui';

export default function FeelInput({ value, onChange, variables, isDark, disabled, placeholder, title, className, size, multiline, mono = true }: {
  value: string;
  onChange: (v: string) => void;
  /** Prozessvariablen für die Vorschläge — ohne sie gibt es keine */
  variables: VarNode[] | null;
  isDark: boolean;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
  /** `md`: so gross wie die übrigen Felder im Klassenbauer */
  size?: 'sm' | 'md';
  /** immer mehrzeilig: bricht um und wächst mit dem Text (z. B. eine Beschreibung) — sonst nur beim Bearbeiten */
  multiline?: boolean;
  /** Text in Festbreitenschrift — FEEL (`= …`) steht immer so */
  mono?: boolean;
}) {
  const c = cls(isDark);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Completion[]>([]);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [active, setActive] = useState(0);
  const open = !!range && items.length > 0;
  const backRef = useRef<HTMLDivElement>(null);
  const highlight = !!variables && isFeel(value);
  // Beim Bearbeiten ganz zu sehen: mehrzeilig, umgebrochen, wächst mit dem
  // Text — sonst eine Zeile wie die übrigen Felder
  const [focused, setFocused] = useState(false);
  const expanded = multiline || focused;
  const box = size === 'md' ? 'text-[11px] leading-[18px] px-2 py-1' : 'text-[10px] px-1.5 py-0.5';
  // FEEL immer in Festbreitenschrift — sonst stünde die Färbung neben dem Text
  const font = mono || highlight ? 'font-mono' : '';
  // Farben: Variablen dunkelblau, Zeichenketten grün, FEEL (Funktionen, Schlüsselwörter) dunkelviolett
  const tone: Record<FeelTokenKind, string> = {
    variable: isDark ? 'text-blue-300' : 'text-blue-800',
    string: isDark ? 'text-green-400' : 'text-green-700',
    feel: isDark ? 'text-purple-300' : 'text-purple-800',
    comment: c.muted,
    plain: '',
  };

  // Vorschläge erst, wenn vor dem Cursor ein Buchstabe des Namens steht oder
  // ein Punkt (`client.` → die Felder) — sonst übernähme Enter (neue Zeile)
  // den obersten Vorschlag
  const refresh = (text: string, cursor: number | null) => {
    if (!variables || cursor == null) { setRange(null); return; }
    const r = completions(text, cursor, variables);
    const typed = !!r && (/[A-Za-z_]/.test(text.slice(r.from, cursor)) || /\.\s*$/.test(text.slice(0, r.from)));
    if (!r || !typed) { setRange(null); setItems([]); return; }
    setItems(r.items.slice(0, 40));
    setRange({ from: r.from, to: r.to });
    setActive(0);
  };

  const close = () => { setRange(null); setItems([]); };

  const accept = (item: Completion) => {
    if (!range) return;
    // steht schon eine Klammer dahinter (`string|(x)`), kommt nur der Name
    const hasParen = !!item.doc && /^\s*\(/.test(value.slice(range.to));
    const insert = hasParen ? item.doc!.name : item.insert;
    const next = value.slice(0, range.from) + insert + value.slice(range.to);
    // Funktionen: der Cursor steht zwischen den Klammern
    const cursor = range.from + insert.length - (hasParen ? 0 : (item.back ?? 0));
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      // schon ganz getippt: Enter gibt die neue Zeile, statt dasselbe nochmals einzusetzen
      if (e.key === 'Enter' && range && items[active]?.insert === value.slice(range.from, range.to)) { close(); return; }
      e.preventDefault();
      accept(items[active]);
    }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <textarea ref={inputRef} rows={1} wrap={expanded ? 'soft' : 'off'}
        value={value} disabled={disabled} placeholder={placeholder} title={title}
        onScroll={e => {
          if (!backRef.current) return;
          backRef.current.scrollLeft = e.currentTarget.scrollLeft;
          backRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        style={highlight ? { color: 'transparent', caretColor: isDark ? '#e5e7eb' : '#111827' } : undefined}
        onChange={e => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKeyDown}
        // Cursor bewegt: eine offene Liste folgt (oder schliesst) — geöffnet wird nur beim Tippen
        onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && open) refresh(value, e.currentTarget.selectionStart); }}
        onClick={() => { if (open) close(); }}
        onFocus={() => setFocused(true)}
        onBlur={e => {
          setFocused(false);
          // zugeklappt wieder vom Anfang an
          e.currentTarget.scrollLeft = 0;
          if (backRef.current) backRef.current.scrollLeft = 0;
          setTimeout(close, 120);
        }}
        // Prosa (eine Beschreibung) darf die Rechtschreibprüfung haben, Ausdrücke nicht
        autoComplete="off" spellCheck={!mono && !highlight}
        className={`block w-full resize-none ${box} rounded border outline-none ${font} ${expanded
          ? '[field-sizing:content] max-h-[60vh] overflow-y-auto'
          : 'overflow-hidden whitespace-pre'} ${c.input}`} />
      {highlight && (
        <div ref={backRef} aria-hidden
          className={`absolute inset-0 overflow-hidden pointer-events-none font-mono border border-transparent ${expanded ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${box}`}>
          {tokenizeFeel(value, variables!).map((t, k) => <span key={k} className={tone[t.kind]}>{t.text}</span>)}
        </div>
      )}
      {open && (
        <div className={`absolute left-0 right-0 top-full mt-0.5 z-30 rounded border shadow-lg ${c.border2} ${c.panelStrong}`}>
          <div ref={listRef} className="max-h-48 overflow-y-auto">
            {items.map((it, i) => (
              <button key={`${it.doc ? 'f:' : 'v:'}${it.path}`} type="button"
                onMouseDown={e => { e.preventDefault(); accept(it); }}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-2 py-1 flex items-baseline gap-2 ${
                  i === active ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                {it.node ? (
                  <>
                    <span className={`text-[10px] font-mono ${tone.variable}`}>{it.node.name}</span>
                    <span className={`text-[9px] font-mono ${c.muted}`}>
                      {it.node.label}{it.node.type === 'context' || it.node.type === 'list' ? ' ›' : ''}
                    </span>
                    <span className={`text-[9px] ml-auto flex-shrink-0 ${c.muted}`}>
                      {FEEL_TYPE_LABEL[it.node.type]}{it.node.optional ? ' · optional' : ''}
                    </span>
                  </>
                ) : it.doc && (
                  <>
                    <span className={`text-[10px] font-mono ${tone.feel}`}>{it.doc.name}</span>
                    <span className={`text-[9px] font-mono truncate ${c.muted}`}>
                      {it.doc.kind === 'function' ? `(${it.doc.signature.slice(it.doc.name.length + 1, -1)})` : ''}
                    </span>
                    <span className={`text-[9px] ml-auto flex-shrink-0 ${c.muted}`}>{it.doc.category}</span>
                  </>
                )}
              </button>
            ))}
          </div>
          {/* Erklärung zum gewählten Vorschlag */}
          {items[active] && <Explain item={items[active]} isDark={isDark} tone={tone} />}
        </div>
      )}
    </div>
  );
}

/** Erklärung unter der Liste: Funktion mit Beispiel, oder Variable mit Herkunft */
function Explain({ item, isDark, tone }: { item: Completion; isDark: boolean; tone: Record<FeelTokenKind, string> }) {
  const c = cls(isDark);
  const box = `px-2 py-1.5 border-t text-[10px] leading-snug ${c.border2} ${c.muted}`;
  if (item.doc) {
    const d = item.doc;
    return (
      <div className={box}>
        <div className={`font-mono ${tone.feel}`}>{d.signature}</div>
        <div className="mt-0.5">{d.description}</div>
        {d.example && <div className="mt-0.5 font-mono">z. B. {d.example}</div>}
      </div>
    );
  }
  const n = item.node!;
  return (
    <div className={box}>
      <div><span className={`font-mono ${tone.variable}`}>{item.path}</span> — {FEEL_TYPE_LABEL[n.type]}{n.optional ? ', optional' : ''} <span className="font-mono">({n.label})</span></div>
      {n.description && <div className="mt-0.5">{n.description}</div>}
      <div className="mt-0.5">aus {n.source}</div>
    </div>
  );
}
