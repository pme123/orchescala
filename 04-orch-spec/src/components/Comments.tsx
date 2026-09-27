// Kommentare wie im arch-review: eine Sprechblase je Stelle, ein seitliches
// Panel mit dem Faden der aktiven Stelle, eine Übersicht über alle Stellen mit
// Kommentaren und eine Schrittfolge («Weiter»/«Zurück» durch alle Stellen mit
// offenen — auf Wunsch auch erledigten — Kommentaren).
//
// Die Daten liegen in der Spezifikation (`spec.comments`); die Prozess-Ansicht
// hält das Panel und reicht über den Kontext hinunter, was eine Sprechblase
// braucht. Ohne Kontext (andere Ansichten) zeigen die Sprechblasen nichts.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CornerDownRight, List, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import {
  addReply, addThread, baseOf, removeEntry, removeThread, setResolved, whenLabel,
  type CommentTargetInfo, type Counts,
} from '../comments';
import type { CommentThread, ProcessSpec } from '../types';
import { cls } from '../ui';

// ── Kontext ──────────────────────────────────────────────────────────────────
interface CommentsCtx {
  exact: Map<string, Counts>;
  under: Map<string, Counts>;
  /** die Stelle, deren Faden im Panel offen ist */
  active: string | null;
  open: (target: string, aggregate?: boolean) => void;
  isDark: boolean;
}

export const CommentsContext = createContext<CommentsCtx | null>(null);

const NONE: Counts = { open: 0, resolved: 0 };

/**
 * Sprechblase an einer Stelle: die Zahl offener Kommentare; nur erledigte →
 * gedämpftes Häkchen; aktiv (im Panel geöffnet) → hervorgehoben. Ohne
 * Kommentare leise — mit `quiet` erst beim Überfahren der Zeile (`group`).
 *
 * `aggregate` zählt die Teile des Elements mit (im Baum: der Schritt samt
 * Mapping, Zweigen …, die man dort nicht sieht).
 */
export function CommentBubble({ target, aggregate, quiet, title, inButton }: {
  target: string; aggregate?: boolean; quiet?: boolean; title?: string;
  /** steht in einem Button (Listenzeile) — dann kein verschachtelter Button */
  inButton?: boolean;
}) {
  const ctx = useContext(CommentsContext);
  if (!ctx) return null;
  const { open, resolved } = (aggregate ? ctx.under : ctx.exact).get(target) ?? NONE;
  const isDark = ctx.isDark;
  const active = aggregate ? baseOf(ctx.active ?? '') === target : ctx.active === target;
  const has = open > 0;
  const tone = active
    ? (isDark ? 'text-blue-300 bg-blue-500/20 border-blue-500/40' : 'text-blue-700 bg-blue-50 border-blue-300')
    : has
      ? (isDark ? 'text-blue-300 border-blue-500/30 hover:bg-blue-500/10' : 'text-blue-700 border-blue-300 hover:bg-blue-50')
      : resolved > 0
        ? (isDark ? 'text-emerald-400/70 border-transparent hover:border-white/20' : 'text-emerald-600/70 border-transparent hover:border-black/20')
        : (isDark ? 'text-white/25 border-transparent hover:text-white/70 hover:border-white/20' : 'text-black/25 border-transparent hover:text-black/70 hover:border-black/20');
  const hidden = quiet && !has && !resolved && !active ? 'opacity-0 group-hover:opacity-100 focus:opacity-100' : '';
  const tip = title ?? (has
    ? `${open} offene${open === 1 ? 'r Kommentar' : ' Kommentare'}`
    : resolved > 0 ? `${resolved} erledigte${resolved === 1 ? 'r Kommentar' : ' Kommentare'}` : 'Kommentieren');
  const className = `inline-flex items-center gap-1 h-[18px] px-1 rounded border text-[10px] font-normal normal-case tracking-normal leading-none flex-shrink-0 transition-colors cursor-pointer ${tone} ${hidden}`;
  const onClick = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); ctx.open(target, aggregate); };
  const inhalt = <><MessageSquare size={11} />{has ? <span>{open}</span> : resolved > 0 ? <Check size={9} /> : null}</>;
  return inButton
    ? <span role="button" data-ctarget={target} onClick={onClick} title={tip} className={className}>{inhalt}</span>
    : <button type="button" data-ctarget={target} onClick={onClick} title={tip} className={className}>{inhalt}</button>;
}

// ── Kürzel ───────────────────────────────────────────────────────────────────
// Wie im arch-review: 1 Buchstabe Vorname + 1 Nachname; ist das Kürzel schon
// vergeben, kommt ein Buchstabe vom Nachnamen dazu (PM › PME › PMEN …).
function nameParts(name: string): string[] {
  let n = name.trim().replace(/\([^)]*\)/g, ' ');
  if (n.includes('@')) n = n.split('@')[0];
  if (n.includes(',')) n = n.split(',').reverse().map(s => s.trim()).join(' ');
  const parts = n.split(/[\s._-]+/).map(s => s.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  return parts.length ? parts : [name.trim() || '?'];
}

function initialsLevel(name: string, level: number): string {
  const parts = nameParts(name);
  const first = parts[0], last = parts[parts.length - 1];
  const raw = parts.length === 1 ? first.slice(0, 2 + level) : first[0] + last.slice(0, 1 + level);
  const max = parts.length === 1 ? first.length : 1 + last.length;
  const want = 2 + level;
  return want > max ? `${raw.toUpperCase()}${want - max + 1}` : raw.toUpperCase();
}

/** Eindeutige Kürzel: wer zuerst kommt, behält das kurze. */
function assignInitials(names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (!key || out.has(key)) continue;
    let level = 0, cand = initialsLevel(n, 0);
    while (taken.has(cand) && level < 12) { level++; cand = initialsLevel(n, level); }
    out.set(key, cand);
    taken.add(cand);
  }
  return out;
}

function AuthorChip({ name, initials, isDark }: { name: string; initials: string; isDark: boolean }) {
  return (
    <span title={name}
      className={`inline-flex items-center justify-center min-w-[26px] h-5 px-1.5 rounded-full text-[10px] font-bold tracking-wide border flex-shrink-0 ${
        isDark ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-300'}`}>
      {initials}
    </span>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────
interface PanelProps {
  spec: ProcessSpec;
  isDark: boolean;
  /** alle Stellen, Reihenfolge = Schrittfolge */
  targets: CommentTargetInfo[];
  /** null = Übersicht */
  active: string | null;
  showResolved: boolean;
  onToggleResolved: (v: boolean) => void;
  onSelect: (key: string | null) => void;
  onClose: () => void;
  canEdit: boolean;
  author: string;
  onChange: (spec: ProcessSpec) => void;
}

const ORPHAN_GROUP = 'Ohne Stelle';

export function CommentsPanel(p: PanelProps) {
  const { spec, isDark, active, showResolved } = p;
  const c = cls(isDark);
  const iconBtn = `p-1 rounded transition-colors disabled:opacity-30 ${isDark ? 'text-white/40 hover:text-white' : 'text-black/40 hover:text-black'}`;
  const btnGhost = `text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-40 ${c.btn}`;
  const btnPrimary = `text-[11px] px-2.5 py-1 rounded font-semibold transition-colors disabled:opacity-40 ${c.btnPrimary}`;

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const comments = useMemo(() => spec.comments ?? [], [spec.comments]);

  // Stellen, die es nicht (mehr) gibt, stehen hinten unter «Ohne Stelle» —
  // was besprochen wurde, soll gelesen und abgehakt werden, nicht verschwinden
  const targets = useMemo(() => {
    const known = new Set(p.targets.map(t => t.key));
    const orphans = [...new Set(comments.map(t => t.target).filter(k => !known.has(k)))]
      .map(key => ({ key, label: key, group: ORPHAN_GROUP }));
    return [...p.targets, ...orphans];
  }, [p.targets, comments]);

  const counts = useMemo(() => {
    const m = new Map<string, Counts>();
    for (const t of comments) {
      const x = m.get(t.target) ?? { open: 0, resolved: 0 };
      if (t.resolved) x.resolved++; else x.open++;
      m.set(t.target, x);
    }
    return m;
  }, [comments]);
  const countOf = (key: string) => counts.get(key) ?? NONE;

  const initials = useMemo(() => {
    const names = comments.flatMap(t => [...t.entries.map(e => e.author), ...(t.resolvedBy ? [t.resolvedBy] : [])]);
    return assignInitials([p.author, ...names]);
  }, [comments, p.author]);
  const initialsFor = (name: string) => initials.get(name.trim().toLowerCase()) ?? initialsLevel(name, 0);

  // Stellenwechsel: Entwürfe verwerfen, neues Kommentarfeld fokussieren
  useEffect(() => { setDraft(''); setReplyTo(null); setReplyDraft(''); }, [active]);
  useEffect(() => {
    // preventScroll: sonst bricht das Fokussieren den Scroll zur Stelle ab
    if (active && p.canEdit) window.setTimeout(() => draftRef.current?.focus({ preventScroll: true }), 50);
  }, [active, p.canEdit]);

  // Esc schliesst (ausser beim Tippen in einem Feld)
  const onClose = p.onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Schrittfolge: Stellen mit (offenen bzw. allen) Kommentaren, in Reihenfolge
  const visible = (key: string) => { const x = countOf(key); return x.open > 0 || (showResolved && x.resolved > 0); };
  const steps = targets.filter(t => visible(t.key));
  const totalOpen = comments.filter(t => !t.resolved).length;
  const totalResolved = comments.length - totalOpen;
  const rank = new Map(targets.map((t, i) => [t.key, i]));
  const pos = active ? rank.get(active) ?? -1 : -1;
  const stepIndex = active ? steps.findIndex(t => t.key === active) : -1;
  // läuft rund: nach der letzten Stelle kommt wieder die erste
  const prev = [...steps].reverse().find(t => (rank.get(t.key) ?? 0) < pos) ?? steps[steps.length - 1];
  const next = steps.find(t => (rank.get(t.key) ?? 0) > pos) ?? steps[0];
  const canStep = steps.length > 1 || (steps.length === 1 && stepIndex < 0);

  const submit = () => {
    if (!active || !draft.trim()) return;
    p.onChange(addThread(spec, active, p.author, draft));
    setDraft('');
  };
  const reply = (threadId: string) => {
    if (!replyDraft.trim()) return;
    p.onChange(addReply(spec, threadId, p.author, replyDraft));
    setReplyTo(null);
    setReplyDraft('');
  };
  const onCmdEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); fn(); }
  };
  const inputCls = `w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`;

  const entryRow = (faden: CommentThread, i: number) => {
    const e = faden.entries[i];
    const isReply = i > 0;
    return (
      <div key={e.id} className={`flex gap-2 ${isReply ? 'ml-5' : ''}`}>
        {isReply && <CornerDownRight size={12} className={`mt-1 flex-shrink-0 ${c.muted}`} />}
        <AuthorChip name={e.author} initials={initialsFor(e.author)} isDark={isDark} />
        <div className="flex-1 min-w-0">
          <div className={`flex items-center gap-2 text-[10px] ${c.muted}`}>
            <span className="truncate" title={e.author}>{e.author}</span>
            <span className="flex-shrink-0">{whenLabel(e.at)}</span>
            <span className="ml-auto flex items-center gap-0.5 flex-shrink-0">
              {p.canEdit && !isReply && (
                <button type="button" title="Antworten" className={iconBtn}
                  onClick={() => { setReplyTo(replyTo === faden.id ? null : faden.id); setReplyDraft(''); }}>
                  <CornerDownRight size={11} />
                </button>
              )}
              {p.canEdit && !isReply && (
                <button type="button" title={faden.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'} className={iconBtn}
                  onClick={() => p.onChange(setResolved(spec, faden.id, !faden.resolved, p.author))}>
                  {faden.resolved ? <RotateCcw size={11} /> : <Check size={11} />}
                </button>
              )}
              {p.canEdit && (
                <button type="button" title={isReply ? 'Antwort löschen' : 'Kommentar samt Antworten löschen'}
                  className={`p-1 rounded transition-colors ${isDark ? 'text-white/30 hover:text-rose-400' : 'text-black/30 hover:text-rose-500'}`}
                  onClick={() => {
                    if (!window.confirm(isReply ? 'Antwort endgültig löschen?' : 'Kommentar samt Antworten endgültig löschen?')) return;
                    p.onChange(isReply ? removeEntry(spec, faden.id, e.id) : removeThread(spec, faden.id));
                  }}>
                  <Trash2 size={11} />
                </button>
              )}
            </span>
          </div>
          <p className={`text-[11px] leading-relaxed whitespace-pre-wrap break-words mt-0.5 ${isDark ? 'text-white/85' : 'text-black/85'}`}>{e.text}</p>
          {!isReply && faden.resolved && (
            <p className={`text-[10px] mt-0.5 ${isDark ? 'text-emerald-400/80' : 'text-emerald-600'}`}>
              ✓ erledigt{faden.resolvedBy ? ` von ${initialsFor(faden.resolvedBy)}` : ''}{faden.resolvedAt ? ` · ${whenLabel(faden.resolvedAt)}` : ''}
            </p>
          )}
        </div>
      </div>
    );
  };

  const thread = (target: string) => {
    const all = comments.filter(t => t.target === target)
      .sort((a, b) => (a.entries[0]?.at ?? '').localeCompare(b.entries[0]?.at ?? ''));
    const roots = all.filter(t => showResolved || !t.resolved);
    const hidden = all.length - roots.length;
    return (
      <div className="space-y-4">
        {roots.length === 0 && (
          <p className={`text-[11px] ${c.muted}`}>
            {hidden > 0 ? `${hidden} erledigte${hidden === 1 ? 'r Kommentar' : ' Kommentare'} ausgeblendet.` : 'Noch keine Kommentare an dieser Stelle.'}
          </p>
        )}
        {roots.map(faden => (
          <div key={faden.id} className={`space-y-2 ${faden.resolved ? 'opacity-60' : ''}`}>
            {faden.entries.map((_, i) => entryRow(faden, i))}
            {replyTo === faden.id && (
              <div className="ml-5 space-y-1.5">
                <textarea value={replyDraft} onChange={e => setReplyDraft(e.target.value)} onKeyDown={onCmdEnter(() => reply(faden.id))}
                  rows={2} autoFocus placeholder="Antwort … (Ctrl/Cmd+Enter sendet)" className={inputCls} />
                <div className="flex gap-1.5">
                  <button type="button" className={btnPrimary} disabled={!replyDraft.trim()} onClick={() => reply(faden.id)}>Antworten</button>
                  <button type="button" className={btnGhost} onClick={() => { setReplyTo(null); setReplyDraft(''); }}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {roots.length > 0 && hidden > 0 && (
          <p className={`text-[10px] ${c.muted}`}>{hidden} erledigte{hidden === 1 ? 'r Kommentar' : ' Kommentare'} ausgeblendet.</p>
        )}
      </div>
    );
  };

  // Übersicht: alle Stellen mit Kommentaren, gruppiert nach Bereich
  const overview = () => {
    if (steps.length === 0) {
      return (
        <p className={`text-[11px] ${c.muted}`}>
          {totalResolved > 0 && !showResolved
            ? `Keine offenen Kommentare — ${totalResolved} erledigte ausgeblendet.`
            : 'Noch keine Kommentare. Die Sprechblase neben einem Schritt, Feld oder Abschnitt öffnet den Faden dieser Stelle.'}
        </p>
      );
    }
    const groups: { group: string; items: CommentTargetInfo[] }[] = [];
    for (const t of steps) {
      const last = groups[groups.length - 1];
      if (last && last.group === t.group) last.items.push(t); else groups.push({ group: t.group, items: [t] });
    }
    return (
      <div className="space-y-3">
        {groups.map((g, i) => (
          <div key={i}>
            <p className={`text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>{g.group}</p>
            <div className="space-y-0.5">
              {g.items.map(t => {
                const x = countOf(t.key);
                const first = comments.find(f => f.target === t.key && (showResolved || !f.resolved))?.entries[0]?.text;
                return (
                  <button key={t.key} type="button" onClick={() => p.onSelect(t.key)}
                    className={`w-full flex items-start gap-2 text-left px-2 py-1.5 rounded transition-colors ${c.hover}`}>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[11px] leading-snug truncate ${isDark ? 'text-white/85' : 'text-black/85'}`}>{t.label}</span>
                      {first && <span className={`block text-[10px] truncate ${c.muted}`}>{first}</span>}
                    </span>
                    <span className={`text-[10px] flex-shrink-0 ${x.open > 0 ? (isDark ? 'text-blue-300' : 'text-blue-700') : c.muted}`}>
                      {x.open > 0 ? `${x.open} offen` : ''}{x.open > 0 && x.resolved > 0 && showResolved ? ' · ' : ''}{showResolved && x.resolved > 0 ? `${x.resolved} erledigt` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const activeInfo = active ? targets.find(t => t.key === active) : null;

  return (
    <aside className={`w-[380px] max-w-[45vw] flex-shrink-0 flex flex-col min-h-0 border-l ${c.border} ${c.panelStrong}`}>
      {/* Kopf */}
      <div className={`px-3 py-2 border-b ${c.border} flex items-center gap-1.5`}>
        {active ? (
          <button type="button" onClick={() => p.onSelect(null)} title="Übersicht aller Kommentare" className={iconBtn}>
            <List size={13} />
          </button>
        ) : (
          <MessageSquare size={13} className={c.muted} />
        )}
        <span className={`text-xs font-semibold flex-1 min-w-0 truncate ${c.text}`}>
          {active ? 'Kommentar' : 'Kommentare'}
          <span className={`ml-2 text-[10px] font-normal ${c.muted}`}>
            {totalOpen} offen{showResolved ? ` · ${totalResolved} erledigt` : ''}
          </span>
        </span>
        <button type="button" onClick={() => prev && p.onSelect(prev.key)} disabled={!canStep} title="Vorherige Stelle" className={iconBtn}>
          <ChevronLeft size={13} />
        </button>
        <span className={`text-[10px] tabular-nums ${c.muted}`}>{stepIndex >= 0 ? `${stepIndex + 1}/${steps.length}` : `${steps.length}`}</span>
        <button type="button" onClick={() => next && p.onSelect(next.key)} disabled={!canStep} title="Nächste Stelle" className={iconBtn}>
          <ChevronRight size={13} />
        </button>
        <button type="button" onClick={p.onClose} title="Schliessen (Esc)" className={iconBtn}>
          <X size={13} />
        </button>
      </div>
      <div className={`px-3 py-1.5 border-b ${c.border} flex items-center gap-3`}>
        <label className={`flex items-center gap-1.5 text-[10px] cursor-pointer ${c.muted}`}>
          <input type="checkbox" checked={showResolved} onChange={e => p.onToggleResolved(e.target.checked)} className="accent-blue-500" />
          Erledigte einblenden
        </label>
        {!active && steps.length > 0 && (
          <button type="button" className={`ml-auto ${btnGhost}`} onClick={() => p.onSelect(steps[0].key)}>
            Alle durchgehen <ChevronRight size={10} className="inline -mt-0.5" />
          </button>
        )}
      </div>
      {activeInfo && (
        <div className={`px-3 py-2 border-b ${c.border}`}>
          <p className={`text-[10px] uppercase tracking-wider ${c.muted}`}>{activeInfo.group}</p>
          <p className={`text-[11px] font-semibold leading-snug break-words ${isDark ? 'text-white/85' : 'text-black/85'}`}>
            {activeInfo.group === ORPHAN_GROUP ? `Stelle gibt es nicht mehr (${activeInfo.key})` : activeInfo.label}
          </p>
        </div>
      )}

      {/* Inhalt */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {active ? thread(active) : overview()}
      </div>

      {/* Neuer Kommentar */}
      {active && p.canEdit && activeInfo?.group !== ORPHAN_GROUP && (
        <div className={`px-3 py-2 border-t ${c.border} space-y-1.5`}>
          <textarea ref={draftRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onCmdEnter(submit)}
            rows={2} placeholder="Neuer Kommentar … (Ctrl/Cmd+Enter sendet)" className={inputCls} />
          <div className="flex items-center gap-2">
            <AuthorChip name={p.author} initials={initialsFor(p.author)} isDark={isDark} />
            <span className={`text-[10px] truncate flex-1 ${c.muted}`}>{p.author}</span>
            <button type="button" className={btnPrimary} disabled={!draft.trim()} onClick={submit}>Kommentieren</button>
          </div>
        </div>
      )}
      {active && !p.canEdit && (
        <div className={`px-3 py-2 border-t ${c.border} text-[10px] ${c.muted}`}>Nur lesen — Kommentieren ist hier nicht möglich.</div>
      )}
    </aside>
  );
}
