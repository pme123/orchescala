// The mapping of a script task, drawn: left its In, right its Out - a line from a field to a
// field. Drag it (or click the one, then the other); a second line onto the same field is its
// fallback (`??`, the first one set wins). An object of the Out opens: a line onto it is what its
// fields with lines of their own are set on (dashed, «Basis» - a copy of it).
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Maximize2, Minimize2, Trash2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VarNode } from '../feel';
import { autoMapped, hasInner, linkPaths, linked, mappingIssues, resolvePath, withLink } from '../fieldMapping';
import type { FieldLink, FieldMapping } from '../types';
import { cls } from '../ui';
import FeelInput from './FeelInput';

const TEAL = '#1D9E75';
const AMBER = '#BA7517';
const GRAY = '#888780';

/** a node that has fields to open - not a list (paths do not go into one) */
const opens = (n: VarNode) => n.type !== 'list' && !!n.children?.length;

export default function FieldMappingEditor({ mapping, target, sources, isDark, canEdit, onChange }: {
  mapping: FieldMapping;
  /** the Out - its variables (children) are the right side */
  target: VarNode;
  /** the In - the left side */
  sources: VarNode[];
  isDark: boolean;
  canEdit: boolean;
  onChange: (m: FieldMapping) => void;
}) {
  const [large, setLarge] = useState(false);
  // Escape closes the large view
  useEffect(() => {
    if (!large) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLarge(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [large]);
  const body = (
    <Editor mapping={mapping} target={target} sources={sources} isDark={isDark} canEdit={canEdit} onChange={onChange}
      large={large} onLarge={setLarge} />
  );
  if (!large) return body;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onMouseDown={e => { if (e.target === e.currentTarget) setLarge(false); }}>
      <div className={`w-[min(1100px,96vw)] max-h-[92vh] overflow-auto rounded-lg border p-4 ${cls(isDark).panelStrong} ${cls(isDark).border} ${cls(isDark).text}`}>
        {body}
      </div>
    </div>,
    document.body,
  );
}

function Editor({ mapping, target, sources, isDark, canEdit, onChange, large, onLarge }: {
  mapping: FieldMapping; target: VarNode; sources: VarNode[]; isDark: boolean; canEdit: boolean;
  onChange: (m: FieldMapping) => void; large: boolean; onLarge: (v: boolean) => void;
}) {
  const c = cls(isDark);
  const err = isDark ? 'text-rose-400' : 'text-rose-600';
  const warn = isDark ? 'text-amber-400' : 'text-amber-600';
  const fields = useMemo(() => target.children ?? [], [target]);
  const issues = useMemo(() => mappingIssues(mapping, target, sources), [mapping, target, sources]);
  const linkOf = (field: string): FieldLink | undefined => mapping.fields.find(l => l.field === field);

  // open nodes of the left tree: the variables, and what a line leaves from
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>(sources.filter(opens).map(v => v.name));
    for (const l of mapping.fields) for (const p of linkPaths(l)) {
      const parts = p.split('.');
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('.'));
    }
    return s;
  });
  // open nodes of the right tree: the objects with lines onto their fields
  const [tOpen, setTOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const l of mapping.fields) {
      const parts = l.field.split('.');
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('.'));
    }
    return s;
  });
  const flip = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (path: string) => set(prev => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const toggle = flip(setOpen);
  const tToggle = flip(setTOpen);
  /** where a line of this path ends: the path itself, or the nearest closed node above it */
  const shownIn = (opened: Set<string>) => (path: string): string => {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      const up = parts.slice(0, i).join('.');
      if (!opened.has(up)) return up;
    }
    return path;
  };
  const visible = shownIn(open);
  const tVisible = shownIn(tOpen);

  const [selected, setSelected] = useState<string | null>(null);
  // click-click: the source chosen first
  const [pending, setPending] = useState<string | null>(null);
  // dragging a line: from where, to the pointer
  const [drag, setDrag] = useState<{ path: string; x: number; y: number; moved: boolean } | null>(null);

  // ── the positions of the rows, for the lines ──
  const box = useRef<HTMLDivElement>(null);
  const leftCol = useRef<HTMLDivElement>(null);
  const rightCol = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ left: Map<string, number>; right: Map<string, number>; x1: number; x2: number; w: number; h: number } | null>(null);
  const measure = useCallback(() => {
    const el = box.current;
    if (!el || !leftCol.current || !rightCol.current) return;
    const at = el.getBoundingClientRect();
    const mid = (r: Element) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 - at.top; };
    const left = new Map<string, number>();
    const right = new Map<string, number>();
    el.querySelectorAll('[data-source]').forEach(r => left.set(r.getAttribute('data-source')!, mid(r)));
    el.querySelectorAll('[data-target]').forEach(r => right.set(r.getAttribute('data-target')!, mid(r)));
    setGeo({
      left, right,
      x1: leftCol.current.getBoundingClientRect().right - at.left,
      x2: rightCol.current.getBoundingClientRect().left - at.left,
      w: at.width, h: at.height,
    });
  }, []);
  useLayoutEffect(measure, [measure, open, tOpen, mapping, fields, sources, large]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const connect = (path: string, field: string) => {
    if (!canEdit) return;
    onChange(linked(mapping, field, path));
    setSelected(field);
    setPending(null);
  };

  // dragging: follow the pointer; let go over a field - connected
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const at = box.current?.getBoundingClientRect();
      if (!at) return;
      setDrag(d => (d ? { ...d, x: e.clientX - at.left, y: e.clientY - at.top, moved: true } : d));
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const field = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-target]')?.getAttribute('data-target');
      if (field) connectRef.current(d.path, field);
      // no move: a click - the source waits for its field
      else if (!d.moved) setPending(p => (p === d.path ? null : d.path));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging]);

  const startDrag = (path: string, e: React.PointerEvent) => {
    if (!canEdit || e.button !== 0) return;
    e.preventDefault();
    const at = box.current?.getBoundingClientRect();
    if (!at) return;
    setDrag({ path, x: e.clientX - at.left, y: e.clientY - at.top, moved: false });
  };

  // ── the lines ──
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(24, (x2 - x1) / 2);
    return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
  };
  const issueOf = (field: string) => issues.find(i => i.field === field);
  const lines: React.ReactNode[] = [];
  if (geo) {
    const { x1, x2 } = geo;
    const knot = x2 - Math.min(28, (x2 - x1) / 3);
    for (const l of mapping.fields) {
      const y2 = geo.right.get(tVisible(l.field));
      if (y2 == null) continue;
      const paths = !l.expression?.trim() ? linkPaths(l) : [];
      const color = issueOf(l.field) ? AMBER : TEAL;
      const width = selected === l.field ? 2.5 : 1.5;
      const pick = (e: React.MouseEvent) => { e.stopPropagation(); setSelected(l.field); };
      // onto an object whose fields have lines of their own: its base - dashed
      const isBase = hasInner(mapping, l.field);
      if (paths.length === 1) {
        const y1 = geo.left.get(visible(paths[0]));
        if (y1 != null) lines.push(<path key={`l-${l.field}`} d={curve(x1, y1, x2, y2)} stroke={isBase && !issueOf(l.field) ? GRAY : color} strokeWidth={width} strokeDasharray={isBase ? '4 4' : undefined} fill="none" className="cursor-pointer" style={{ pointerEvents: 'stroke' }} onClick={pick} />);
      } else if (paths.length > 1) {
        paths.forEach((p, k) => {
          const y1 = geo.left.get(visible(p));
          if (y1 != null) lines.push(<path key={`l-${l.field}-${k}`} d={curve(x1, y1, knot - 8, y2)} stroke={color} strokeWidth={width} strokeDasharray={k ? '5 3' : undefined} fill="none" className="cursor-pointer" style={{ pointerEvents: 'stroke' }} onClick={pick} />);
        });
        lines.push(
          <g key={`k-${l.field}`} className="cursor-pointer" style={{ pointerEvents: 'all' }} onClick={pick}>
            <path d={`M${knot + 8} ${y2} L${x2} ${y2}`} stroke={color} strokeWidth={width} />
            <circle cx={knot} cy={y2} r={8} fill={isDark ? '#16171a' : '#fff'} stroke={color} strokeWidth={1.2} />
            <text x={knot} y={y2 + 3} textAnchor="middle" fontSize={8} fill={color}>??</text>
          </g>,
        );
      }
    }
    if (drag?.moved) {
      const y1 = geo.left.get(visible(drag.path));
      if (y1 != null) lines.push(<path key="drag" d={curve(x1, y1, drag.x, drag.y)} stroke={TEAL} strokeWidth={1.5} strokeDasharray="3 3" fill="none" />);
    }
  }

  // ── the rows ──
  const text = large ? 'text-[12px]' : 'text-[10px]';
  const rowH = large ? 'h-7' : 'h-6';
  const linkedPaths = new Set(mapping.fields.flatMap(l => (l.expression?.trim() ? [] : linkPaths(l))));
  const sourceRow = (n: VarNode, path: string, depth: number): React.ReactNode => {
    const isOpen = open.has(path);
    const used = linkedPaths.has(path) || [...linkedPaths].some(p => p.startsWith(`${path}.`) && !isOpen);
    return (
      <div key={path}>
        <div data-source={path}
          onPointerDown={e => startDrag(path, e)}
          onClick={e => e.stopPropagation()}
          title={`${path}: ${n.label}${n.description ? `\n${n.description}` : ''}${canEdit ? '\nZiehen (oder klicken, dann das Feld rechts klicken)' : ''}`}
          className={`${rowH} flex items-center gap-1 pr-2 rounded border select-none ${text} ${canEdit ? 'cursor-grab' : ''} ${pending === path ? (isDark ? 'border-teal-400 bg-teal-400/10' : 'border-teal-600 bg-teal-600/10') : c.border} ${depth === 0 ? (isDark ? 'bg-violet-400/10' : 'bg-violet-600/5') : ''}`}
          style={{ paddingLeft: 4 + depth * 12 }}>
          {opens(n)
            ? <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => toggle(path)} className={`flex-shrink-0 ${c.muted}`} aria-label={isOpen ? 'Zuklappen' : 'Aufklappen'}>
                {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            : <span className="w-[10px] flex-shrink-0" />}
          <span className={`font-mono truncate ${depth === 0 ? 'font-semibold' : ''}`}>{n.name}</span>
          <span className={`ml-auto pl-1 truncate text-[9px] ${c.muted}`}>{n.label}</span>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: used ? TEAL : 'transparent', border: `1px solid ${used ? TEAL : GRAY}` }} />
        </div>
        {isOpen && opens(n) && (
          <div className="space-y-0.5 mt-0.5">{(n.children ?? []).map(ch => sourceRow(ch, `${path}.${ch.name}`, depth + 1))}</div>
        )}
      </div>
    );
  };

  const targetRow = (f: VarNode, path: string, depth: number): React.ReactNode => {
    const l = linkOf(path);
    const iss = issueOf(path);
    const isOpen = tOpen.has(path);
    const inner = hasInner(mapping, path);
    const isBase = !!l && inner;
    const dot = l || (inner && !isOpen) ? (iss ? AMBER : TEAL) : null;
    return (
      <div key={path}>
        <div data-target={path}
          onClick={e => { e.stopPropagation(); if (pending) connect(pending, path); else setSelected(s => (s === path ? null : path)); }}
          title={`${path}: ${f.label}${f.description ? `\n${f.description}` : ''}${iss ? `\n${iss.text}` : ''}`}
          className={`${rowH} flex items-center gap-1 pr-1.5 rounded border cursor-pointer ${text} ${selected === path ? (isDark ? 'border-teal-400' : 'border-teal-600') : iss?.level === 'error' ? (isDark ? 'border-rose-500/60' : 'border-rose-400') : c.border} ${drag?.moved ? (isDark ? 'hover:bg-teal-400/10' : 'hover:bg-teal-600/10') : c.hover}`}
          style={{ paddingLeft: 4 + depth * 12 }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot ?? 'transparent', border: `1px solid ${dot ?? GRAY}` }} />
          {opens(f)
            ? <button type="button" onClick={e => { e.stopPropagation(); tToggle(path); }} className={`flex-shrink-0 ${c.muted}`} aria-label={isOpen ? 'Zuklappen' : 'Aufklappen'}
                title={isOpen ? 'Zuklappen' : 'Aufklappen - die Felder darin einzeln zuordnen'}>
                {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            : depth > 0 && <span className="w-[10px] flex-shrink-0" />}
          <span className="font-mono truncate">{f.name}</span>
          {l?.expression?.trim() && <span className={`text-[8px] px-1 rounded ${isDark ? 'bg-teal-400/15 text-teal-300' : 'bg-teal-600/10 text-teal-700'}`}>fx</span>}
          {isBase && <span className={`text-[8px] ${c.muted}`} title={`Eine Kopie von ${linkPaths(l!).join(' ?? ') || 'dem Ausdruck'} - die Felder mit eigener Linie geändert`}>Basis</span>}
          <span className={`ml-auto pl-1 truncate text-[9px] ${c.muted}`}>{f.label}</span>
        </div>
        {isOpen && opens(f) && (
          <div className="space-y-0.5 mt-0.5">{(f.children ?? []).map(ch => targetRow(ch, `${path}.${ch.name}`, depth + 1))}</div>
        )}
      </div>
    );
  };

  const mapped = fields.filter(f => linkOf(f.name) || hasInner(mapping, f.name)).length;
  const sel = selected ? resolvePath(fields, selected) ?? undefined : undefined;
  const selLink = selected ? linkOf(selected) : undefined;

  if (!fields.length) {
    return (
      <p className={`text-[10px] ${c.muted}`}>Erst im Out die Variable angeben, die der Schritt setzt - dann lässt sie sich zuordnen.</p>
    );
  }

  return (
    <div className="space-y-2" onClick={() => setPending(null)}>
      {/* toolbar */}
      <div className={`flex items-center gap-2 flex-wrap ${text}`}>
        <button type="button" disabled={!canEdit} onClick={e => { e.stopPropagation(); onChange(autoMapped(mapping, target, sources, tOpen, open)); }}
          title="Was rechts offen ist, bekommt Linien: jedes Feld ohne Wert eines gleichen Namens und Typs aus dem, was links offen ist - auch in tieferen Ebenen. Zugeklappt als Ganzes; ein offenes Objekt ohne Basis eine Variable seines Typs als Basis"
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${c.btn} disabled:opacity-40`}>
          <Wand2 size={10} /> Automatisch zuordnen
        </button>
        <span className={`ml-auto ${c.muted}`}>{mapped} von {fields.length} zugeordnet</span>
        <button type="button" onClick={e => { e.stopPropagation(); onLarge(!large); }} title={large ? 'Verkleinern (Esc)' : 'Gross öffnen'}
          className={`p-1 rounded border ${c.btn}`} aria-label={large ? 'Verkleinern' : 'Gross öffnen'}>
          {large ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
        </button>
      </div>

      {/* the two sides and the lines between them */}
      <div ref={box} className="relative grid items-start" style={{ gridTemplateColumns: large ? 'minmax(0,1fr) 180px minmax(0,1fr)' : 'minmax(0,1fr) 56px minmax(0,1fr)' }}>
        <div ref={leftCol} className="space-y-0.5 min-w-0">
          <div className={`text-[9px] uppercase tracking-wide mb-1 ${c.muted}`}>In</div>
          {sources.length ? sources.map(s => sourceRow(s, s.name, 0)) : <p className={`text-[10px] ${c.muted}`}>Das In ist leer - oben angeben, was der Schritt liest.</p>}
        </div>
        <div />
        <div ref={rightCol} className="space-y-0.5 min-w-0">
          <div className={`text-[9px] uppercase tracking-wide mb-1 ${c.muted}`}>Out</div>
          {fields.map(f => targetRow(f, f.name, 0))}
        </div>
        {geo && (
          <svg className="absolute inset-0 pointer-events-none overflow-visible" width={geo.w} height={geo.h}>
            {lines}
          </svg>
        )}
      </div>

      {pending && <p className={`text-[10px] ${c.muted}`}>Jetzt rechts das Feld klicken, das <span className="font-mono">{pending}</span> bekommt.</p>}

      {/* the field chosen: its paths in order, or a FEEL expression */}
      {sel && (
        <div className={`rounded border p-2 space-y-1.5 ${c.border}`} onClick={e => e.stopPropagation()}>
          <div className={`flex items-center gap-2 ${text}`}>
            <span className="font-mono font-semibold">{selected}</span>
            <span className={`text-[9px] ${c.muted}`}>{sel.label}</span>
            {selLink && canEdit && (
              <button type="button" onClick={() => { onChange(withLink(mapping, selected!, null)); }} title="Zuordnung entfernen"
                className={`ml-auto p-0.5 rounded ${c.muted} hover:text-rose-500`} aria-label="Zuordnung entfernen"><Trash2 size={10} /></button>
            )}
          </div>
          {!selLink?.expression?.trim() && (
            selLink && linkPaths(selLink).length
              ? <div className="space-y-0.5">
                  {linkPaths(selLink).map((p, k, all) => {
                    const n = resolvePath(sources, p);
                    const move = (to: number) => {
                      const next = [...all];
                      [next[k], next[to]] = [next[to], next[k]];
                      onChange(withLink(mapping, selected!, { from: next }));
                    };
                    return (
                      <div key={p} className={`flex items-center gap-1 text-[10px]`}>
                        <span className={`w-10 ${c.muted}`}>{k === 0 ? 'Wert' : 'sonst'}</span>
                        <span className="font-mono truncate">{p}</span>
                        <span className={`text-[9px] ${n ? c.muted : err}`}>{n ? n.label : 'unbekannt'}</span>
                        {canEdit && <span className="ml-auto flex items-center gap-0.5">
                          <button type="button" disabled={k === 0} onClick={() => move(k - 1)} className={`p-0.5 ${c.muted} disabled:opacity-30`} aria-label="Nach oben"><ArrowUp size={10} /></button>
                          <button type="button" disabled={k === all.length - 1} onClick={() => move(k + 1)} className={`p-0.5 ${c.muted} disabled:opacity-30`} aria-label="Nach unten"><ArrowDown size={10} /></button>
                          <button type="button" onClick={() => onChange(withLink(mapping, selected!, { from: all.filter(x => x !== p) }))} className={`p-0.5 ${c.muted} hover:text-rose-500`} aria-label="Linie entfernen"><Trash2 size={10} /></button>
                        </span>}
                      </div>
                    );
                  })}
                  {linkPaths(selLink).length > 1 && <p className={`text-[9px] ${c.muted}`}>Der erste gesetzte Wert gewinnt (nicht null).</p>}
                </div>
              : <p className={`text-[10px] ${c.muted}`}>Noch keine Linie - links ein Feld hierher ziehen.</p>
          )}
          {opens(sel) && (
            <p className={`text-[9px] ${c.muted}`}>
              {hasInner(mapping, selected!)
                ? `Die Felder darin mit eigener Linie werden gesetzt - ${selLink ? 'der Rest kommt von der Linie auf das Objekt (Basis).' : 'ohne Linie auf das Objekt (Basis) brauchen die Pflichtfelder eine Linie.'}`
                : 'Aufklappen, um die Felder darin einzeln zuzuordnen - eine Linie auf das Objekt ist dann ihre Basis.'}
            </p>
          )}
          <div className="flex items-center gap-2 text-[10px]">
            <span className={`${c.muted} w-24 flex-shrink-0`}>oder FEEL</span>
            <FeelInput value={selLink?.expression ?? ''} disabled={!canEdit} isDark={isDark} variables={sources} className="flex-1 min-w-0"
              onChange={v => onChange(withLink(mapping, selected!, { expression: v || undefined }))}
              placeholder={`= lower case(${linkPaths(selLink ?? { field: '', from: [] })[0] ?? 'client.email'})`}
              title="Statt der Linien ein FEEL-Ausdruck für dieses Feld - im Scala übersetzt wie ein Mapping" />
          </div>
        </div>
      )}

      {issues.map((it, k) => (
        <p key={k} className={`text-[10px] flex items-start gap-1 ${it.level === 'error' ? err : warn}`}>
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{it.text}</span>
        </p>
      ))}
    </div>
  );
}
