// Markdown-Feld: ausserhalb der Bearbeitung formatiert angezeigt (Klick
// bearbeitet), beim Markieren eine kleine Formatleiste (fett, kursiv, Code,
// Link, Aufzählung, Formatierung entfernen), dazu Cmd/Ctrl+B, +I, +K.
// Gespeichert wird Standard-Markdown — es geht so in die Exporte.
import { useLayoutEffect, useRef, useState } from 'react';
import { Bold, Code, Italic, Link2, List, RemoveFormatting } from 'lucide-react';
import { clearFormat, makeLink, renderMarkdown, toggleList, toggleWrap, type Edit } from '../markdownEdit';

export function MarkdownField(p: {
  value: string;
  onChange: (v: string) => void;
  isDark: boolean;
  disabled?: boolean;
  rows: number;
  placeholder?: string;
  /** Klassen des Eingabefelds (Rahmen, Hintergrund, Schrift) — die Anzeige übernimmt sie */
  className: string;
}) {
  const { isDark } = p;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [bar, setBar] = useState<{ top: number; left: number } | null>(null);
  const focusPending = useRef(false);
  const showRendered = !editing && p.value.trim() !== '';

  // Höhe am Inhalt ausrichten (mindestens «rows») und beim Wechsel aus der
  // Anzeige gleich fokussieren — sonst schrumpft das Feld, der Inhalt darunter
  // springt hoch und der Klick landet daneben
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t || showRendered) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + t.offsetHeight - t.clientHeight}px`;
    if (focusPending.current) {
      focusPending.current = false;
      t.focus({ preventScroll: true });
      t.setSelectionRange(t.value.length, t.value.length);
    }
  }, [showRendered, p.value]);

  const startEdit = () => {
    if (p.disabled || editing) return;
    focusPending.current = true;
    setEditing(true);
  };

  // Position der Markierung im Feld: gespiegeltes div mit denselben Massen
  const caretXY = (el: HTMLTextAreaElement, pos: number) => {
    const cs = getComputedStyle(el);
    const div = document.createElement('div');
    for (const k of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
      'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'wordSpacing', 'tabSize'] as const) {
      div.style[k] = cs[k];
    }
    Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' });
    div.textContent = el.value.slice(0, pos);
    const span = document.createElement('span');
    span.textContent = el.value.slice(pos) || '.';
    div.appendChild(span);
    document.body.appendChild(div);
    const r = { top: span.offsetTop - el.scrollTop, left: span.offsetLeft - el.scrollLeft };
    div.remove();
    return r;
  };
  const BAR_W = 168;
  const updateBar = () => {
    const el = ref.current;
    if (p.disabled || !el || el.selectionStart === el.selectionEnd || document.activeElement !== el) { setBar(null); return; }
    const c = caretXY(el, el.selectionStart);
    setBar({ top: el.offsetTop + c.top - 30, left: Math.min(Math.max(0, el.offsetLeft + c.left - 8), Math.max(0, el.offsetWidth - BAR_W)) });
  };
  const apply = (fn: (v: string, s: number, e: number) => Edit) => {
    const el = ref.current;
    if (!el) return;
    const r = fn(p.value, el.selectionStart, el.selectionEnd);
    p.onChange(r.value);
    setTimeout(() => { const t = ref.current; if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(r.start, r.end); updateBar(); } }, 0);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); apply((v, s, en) => toggleWrap(v, s, en, '**', '**')); }
    else if (k === 'i') { e.preventDefault(); apply((v, s, en) => toggleWrap(v, s, en, '_', '_')); }
    else if (k === 'k') { e.preventDefault(); apply(makeLink); }
  };

  const barBtn = `w-6 h-6 inline-flex items-center justify-center rounded transition-colors ${isDark ? 'text-white/80 hover:bg-white/10' : 'text-black/80 hover:bg-black/5'}`;
  const sep = <span className={`w-px h-4 mx-0.5 ${isDark ? 'bg-white/15' : 'bg-black/15'}`} />;
  return (
    <div className="relative w-full">
      {showRendered ? (
        <div role="textbox" aria-readonly={p.disabled} tabIndex={p.disabled ? -1 : 0}
          title={p.disabled ? undefined : 'Klicken zum Bearbeiten'}
          onClick={e => { if (!(e.target as HTMLElement).closest('a')) startEdit(); }}
          onFocus={startEdit}
          className={`${p.className} md md-view ${p.disabled ? '' : 'cursor-text'}`}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(p.value) }} />
      ) : (
        <textarea ref={ref} value={p.value} rows={p.rows} placeholder={p.placeholder} disabled={p.disabled}
          onChange={e => p.onChange(e.target.value)}
          onKeyDown={onKeyDown} onSelect={updateBar} onMouseUp={updateBar} onKeyUp={updateBar} onScroll={() => setBar(null)}
          onFocus={() => setEditing(true)}
          onBlur={() => { setBar(null); setEditing(false); }}
          className={p.className} />
      )}
      {/* Formatleiste über der Markierung — mousedown ohne Fokuswechsel, damit die Markierung bleibt */}
      {bar && !showRendered && (
        <div style={{ top: bar.top, left: bar.left, width: BAR_W }} onMouseDown={e => e.preventDefault()}
          className={`absolute z-30 flex items-center gap-0.5 p-0.5 rounded-md border shadow-lg ${isDark ? 'bg-[#1f2024] border-white/15' : 'bg-white border-black/15'}`}>
          <button type="button" title="Fett (Cmd/Ctrl+B)" className={barBtn} onClick={() => apply((v, s, e) => toggleWrap(v, s, e, '**', '**'))}><Bold size={12} /></button>
          <button type="button" title="Kursiv (Cmd/Ctrl+I)" className={barBtn} onClick={() => apply((v, s, e) => toggleWrap(v, s, e, '_', '_'))}><Italic size={12} /></button>
          <button type="button" title="Code (Variable, Topic …)" className={barBtn} onClick={() => apply((v, s, e) => toggleWrap(v, s, e, '`', '`'))}><Code size={12} /></button>
          <button type="button" title="Link (Cmd/Ctrl+K) — danach die Adresse eintippen" className={barBtn} onClick={() => apply(makeLink)}><Link2 size={12} /></button>
          {sep}
          <button type="button" title="Aufzählung" className={barBtn} onClick={() => apply(toggleList)}><List size={12} /></button>
          <button type="button" title="Formatierung entfernen" className={barBtn} onClick={() => apply(clearFormat)}><RemoveFormatting size={12} /></button>
        </div>
      )}
    </div>
  );
}
