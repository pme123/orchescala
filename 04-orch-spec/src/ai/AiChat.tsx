// The chat of the AI mode - the same for pages (stage A) and processes (stage B). The RE writes what
// they want; Claude changes a draft with the tools of the kit and corrects it until the findings show no
// errors of its own. The designer shows the draft; the RE accepts it - like a change by hand - or
// discards it. Only shown with a key (E20): the designers mount it only then.
import type { BetaMessageParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { AlertTriangle, Check, CircleStop, Info, Loader2, MessageSquarePlus, Send as SendIcon, Sparkles, Undo2, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cls } from '../ui';
import { runTurn, type AgentEvent, type Stop } from './agent';
import { claudeSender, errorText } from './client';
import { addUsage, NO_USAGE, usageLine, type Usage } from './cost';
import { useAiWorkspace } from './key';
import type { ToolKit } from './toolkit';

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'claude'; text: string }
  | { kind: 'tool'; text: string; isError: boolean }
  | { kind: 'check'; errors: string[] }
  | { kind: 'done'; usage: Usage; stop: Stop; errors: string[]; openPoints: string[]; changed: boolean }
  | { kind: 'note'; text: string; tone?: 'error' | 'ok'; undo?: boolean };

const STOP_TEXT: Partial<Record<Stop, string>> = {
  max_steps: 'Claude hat zu viele Schritte gebraucht und wurde angehalten.',
  max_tokens: 'Die Antwort war zu lang und wurde abgeschnitten.',
  refusal: 'Claude hat die Anfrage abgelehnt.',
  cancelled: 'Abgebrochen.',
  context: 'Das Gespräch ist zu lang geworden – mit «Neues Gespräch» (oben im Chat) neu beginnen.',
};

/** What came of «Übernehmen»: nothing (taken over and saved), refused (the draft stays - e.g. the spec
  * changed since the draft began), or taken over but not saved (the view has it, the file not). */
export type AcceptOutcome = void | { refused: string } | { saveError: string };

export type AiChatProps<D> = {
  isDark: boolean;
  apiKey: string;
  /** the system of a conversation - built at its start and then kept (cache) */
  system: () => BetaTextBlockParam[];
  kit: ToolKit<D>;
  draft: D | null;
  onDraft: (d: D | null) => void;
  /** a new draft from what is saved now */
  start: () => D;
  changed: (d: D) => boolean;
  openPoints: (d: D) => string[];
  /** the first request of a conversation names what the draft is about */
  firstPrompt: (text: string) => string;
  /** the differences of the draft - shown above Accept/Discard */
  changes: React.ReactNode;
  /** takes the draft over; `requests`: what the RE asked for it (for the log) */
  onAccept: (d: D, requests: string[]) => AcceptOutcome | Promise<AcceptOutcome>;
  /** undo of the last accepted draft - where the designer has no undo of its own (processes) */
  undo?: { label: string; run: () => AcceptOutcome | Promise<AcceptOutcome> } | null;
  /** «Übernommen – …» */
  acceptedText: string;
  hint: React.ReactNode;
  placeholder: string;
  /** a request that starts at once */
  initialPrompt?: string;
  /** the request from outside was started - the parent drops it, so a later mount does not send it again */
  onInitialPrompt?: () => void;
};

export function AiChat<D>(p: AiChatProps<D>) {
  const { isDark, draft } = p;
  const c = cls(isDark);
  const workspace = useAiWorkspace();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Usage | null>(null);
  const [total, setTotal] = useState<Usage>(NO_USAGE);
  // the conversation with the API and its system - fixed at its start, so the cache holds
  const history = useRef<BetaMessageParam[]>([]);
  const system = useRef<BetaTextBlockParam[] | null>(null);
  // what Claude does not know yet: the RE accepted or discarded the last draft
  const note = useRef<string | null>(null);
  // the requests of the RE for the current draft - for the log when it is accepted
  const requests = useRef<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  // the running turn: a new conversation or leaving the designer starts a new one - an older turn
  // that ends afterwards writes nothing (no history, no draft, no entries)
  const turn = useRef(0);
  // the draft comes from a turn that did not finish (step limit, cut off, cancelled, error) - it may be half done
  const [incomplete, setIncomplete] = useState(false);
  const [accepting, setAccepting] = useState(false);
  // the same as a ref: two clicks in one tick see the state of the last render
  const acceptingNow = useRef(false);
  const undoingNow = useRef(false);
  // the request from outside (a new page with a description) - started once
  const started = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const add = (...e: Entry[]) => setEntries((list) => [...list, ...e]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [entries, busy]);
  // leaving the designer or deleting the key stops a running request
  // (in dev, StrictMode mounts twice: the request from outside is then started again on the second mount)
  useEffect(() => () => { turn.current++; abort.current?.abort(); abort.current = null; started.current = false; }, []);

  const ask = async (text: string) => {
    // a turn runs (abort is set at once, before the first await) or a draft is being taken over
    if (!text.trim() || abort.current || acceptingNow.current) return;
    const sys = system.current ?? p.system();
    system.current = sys;
    const prompt = [note.current, history.current.length === 0 ? p.firstPrompt(text.trim()) : text.trim()].filter(Boolean).join('\n\n');
    note.current = null;
    const controller = new AbortController();
    const id = ++turn.current;
    const current = () => turn.current === id;
    abort.current = controller;
    setBusy(true);
    setInput('');
    add({ kind: 'user', text: text.trim() });
    const onEvent = (e: AgentEvent) => {
      if (!current()) return;
      if (e.kind === 'text') add({ kind: 'claude', text: e.text });
      else if (e.kind === 'tool') add({ kind: 'tool', text: e.summary, isError: e.isError });
      else if (e.kind === 'check') add({ kind: 'check', errors: e.errors });
      else setLive(e.usage);
    };
    try {
      const before = draft ?? p.start();
      const r = await runTurn({
        send: claudeSender(p.apiKey, workspace), system: sys, kit: p.kit,
        history: history.current, prompt, draft: before, onEvent, signal: controller.signal,
      });
      if (!current()) return;
      history.current = r.history;
      setTotal((t) => addUsage(t, r.usage));
      const changed = p.changed(r.draft);
      if (changed) requests.current = [...requests.current, text.trim()];
      setIncomplete(changed && r.stop !== 'done');
      p.onDraft(changed ? r.draft : null);
      const known = new Set(p.openPoints(before));
      add(
        ...(r.stop === 'error' ? [{ kind: 'note' as const, text: errorText(r.error), tone: 'error' as const }] : []),
        ...(STOP_TEXT[r.stop] ? [{ kind: 'note' as const, text: STOP_TEXT[r.stop]!, tone: 'error' as const }] : []),
        { kind: 'done', usage: r.usage, stop: r.stop, errors: r.errors, openPoints: p.openPoints(r.draft).filter((x) => !known.has(x)), changed },
      );
      // for measuring the costs: token counts only, no content (docs/KI-MODUS.md)
      console.info('[orch-spec KI]', usageLine(r.usage), r.usage);
    } catch (e) {
      // not from the API (runTurn turns those into a stop) - a bug in the app; the chat stays usable
      if (current()) add({ kind: 'note', text: `Unerwarteter Fehler: ${errorText(e)}`, tone: 'error' });
    } finally {
      if (current()) {
        abort.current = null;
        setBusy(false);
        setLive(null);
      }
    }
  };

  // a request from outside (a new page with a description): start right away, once
  useEffect(() => {
    if (p.initialPrompt && !started.current) { started.current = true; p.onInitialPrompt?.(); void ask(p.initialPrompt); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.initialPrompt]);

  const accept = async () => {
    if (!draft || acceptingNow.current || abort.current) return;
    acceptingNow.current = true;
    setAccepting(true);
    let r: AcceptOutcome;
    try {
      r = await p.onAccept(draft, requests.current);
    } catch (e) {
      r = { refused: `Übernehmen fehlgeschlagen: ${errorText(e)}` };
    } finally {
      acceptingNow.current = false;
      setAccepting(false);
    }
    // refused: nothing changed - the draft stays, to discard it or to try again
    if (r && 'refused' in r) { add({ kind: 'note', text: r.refused, tone: 'error' }); return; }
    requests.current = [];
    setIncomplete(false);
    p.onDraft(null);
    note.current = 'Der RE hat deinen Entwurf übernommen – er ist jetzt der Stand der Spezifikation.';
    add(r && 'saveError' in r
      ? { kind: 'note', text: `Übernommen, aber nicht gespeichert: ${r.saveError}`, tone: 'error' }
      : { kind: 'note', text: p.acceptedText, tone: 'ok', undo: true });
  };
  // undo of the last accepted draft: like accepting, a failed save is said as such
  const undoLast = async () => {
    if (!p.undo || undoingNow.current) return;
    undoingNow.current = true;
    let r: AcceptOutcome;
    try {
      r = await p.undo.run();
    } catch (e) {
      r = { refused: `Rückgängig fehlgeschlagen: ${errorText(e)}` };
    } finally {
      undoingNow.current = false;
    }
    if (r && 'refused' in r) { add({ kind: 'note', text: r.refused, tone: 'error' }); return; }
    note.current = 'Der RE hat deine letzte übernommene Änderung rückgängig gemacht.';
    add(r && 'saveError' in r
      ? { kind: 'note', text: `Rückgängig gemacht, aber nicht gespeichert: ${r.saveError}`, tone: 'error' }
      : { kind: 'note', text: 'Rückgängig gemacht.' });
  };
  const discard = () => {
    p.onDraft(null);
    requests.current = [];
    setIncomplete(false);
    note.current = 'Der RE hat deinen letzten Entwurf verworfen – es gilt wieder der Stand vor deinen Änderungen.';
    add({ kind: 'note', text: 'Verworfen – alles ist wie vorher.' });
  };
  const restart = () => {
    // the running turn (if any) is over: what it still brings is dropped
    turn.current++;
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    setLive(null);
    setIncomplete(false);
    history.current = [];
    system.current = null;
    note.current = null;
    requests.current = [];
    p.onDraft(null);
    setEntries([]);
    setTotal(NO_USAGE);
  };

  const tone = (t?: 'error' | 'ok') => (t === 'error' ? (isDark ? 'text-rose-300' : 'text-rose-700') : t === 'ok' ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : c.muted2);
  const lastAccepted = entries.map((e, i) => (e.kind === 'note' && e.undo ? i : -1)).reduce((a, b) => Math.max(a, b), -1);

  return (
    <div className="flex flex-col h-full">
      <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b ${c.border}`}>
        <Sparkles size={12} className={isDark ? 'text-violet-300' : 'text-violet-600'} />
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>Claude</span>
        {total.requests > 0 && <span className={`text-[9px] ${c.muted}`} title={usageLine(total)}>{usageLine(total).split(' · ').pop()} gesamt</span>}
        <button onClick={restart} title="Neues Gespräch – Claude vergisst den bisherigen Chat"
          className={`ml-auto p-1 rounded ${c.muted} hover:opacity-100`}><MessageSquarePlus size={12} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-[11px] leading-snug">
        {entries.length === 0 && <div className={`space-y-2 ${c.muted}`}>{p.hint}</div>}
        {entries.map((e, i) => {
          switch (e.kind) {
            case 'user':
              return <div key={i} className={`ml-6 rounded px-2 py-1.5 whitespace-pre-wrap ${isDark ? 'bg-sky-500/15 text-sky-100' : 'bg-sky-50 text-sky-950'}`}>{e.text}</div>;
            case 'claude':
              return <div key={i} className={`mr-4 whitespace-pre-wrap ${c.text}`}>{e.text}</div>;
            case 'tool':
              return (
                <div key={i} className={`flex items-start gap-1.5 text-[10px] ${e.isError ? (isDark ? 'text-amber-300' : 'text-amber-700') : c.muted}`}>
                  <Wrench size={9} className="mt-0.5 flex-shrink-0" /><span>{e.text}</span>
                </div>
              );
            case 'check':
              return (
                <div key={i} className={`text-[10px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                  <div className="flex items-center gap-1"><AlertTriangle size={9} /> Prüfung: noch Fehler – Claude korrigiert</div>
                  {e.errors.map((m, j) => <div key={j} className="ml-3">· {m}</div>)}
                </div>
              );
            case 'done':
              return (
                <div key={i} className={`rounded border px-2 py-1.5 space-y-1 text-[10px] ${c.border2}`}>
                  {e.errors.length > 0 && <div className={tone('error')}>Der Entwurf hat noch Fehler: {e.errors.join(' · ')}</div>}
                  {e.openPoints.length > 0 && (
                    <div className={isDark ? 'text-amber-300' : 'text-amber-700'}>
                      Offene Punkte (für die Entwicklung):{e.openPoints.map((x, j) => <div key={j} className="ml-2">· {x}</div>)}
                    </div>
                  )}
                  {!e.changed && e.stop === 'done' && <div className={c.muted}>Keine Änderung.</div>}
                  <div className={c.muted} title="Tokens und Kosten dieser Änderung (Preise Claude Opus 5.5, Oktober 2026 – hat ein anderes Modell geantwortet, ist der Betrag geschätzt)">{usageLine(e.usage)}</div>
                </div>
              );
            case 'note':
              return (
                <div key={i} className={`flex items-start gap-1.5 text-[10px] ${tone(e.tone)}`}>
                  <Info size={10} className="mt-0.5 flex-shrink-0" /><span className="flex-1">{e.text}</span>
                  {e.undo && i === lastAccepted && p.undo && !draft && !busy && (
                    <button onClick={() => void undoLast()}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${c.btn}`} title={p.undo.label}>
                      <Undo2 size={10} /> Rückgängig
                    </button>
                  )}
                </div>
              );
          }
        })}
        {busy && (
          <div className={`flex items-center gap-1.5 text-[10px] ${c.muted}`}>
            <Loader2 size={11} className="animate-spin" /> Claude arbeitet …{live && <span>{usageLine(live)}</span>}
          </div>
        )}
        <div ref={end} />
      </div>

      {draft && !busy && (
        <div className={`flex-shrink-0 border-t px-3 py-2 space-y-1.5 ${c.border} ${isDark ? 'bg-violet-500/10' : 'bg-violet-50'}`}>
          <div className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? 'text-violet-200' : 'text-violet-800'}`}>Entwurf – Unterschiede</div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">{p.changes}</div>
          {incomplete && (
            <div className={`flex items-start gap-1.5 text-[10px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" />
              <span>Claude wurde nicht fertig – der Entwurf kann unvollständig sein. Weiterschreiben lassen, verwerfen oder bewusst so übernehmen.</span>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={discard} disabled={accepting} className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}><X size={11} /> Verwerfen</button>
            <button onClick={() => void accept()} disabled={accepting} className={`ml-auto flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border border-transparent ${c.btnPrimary}`}><Check size={11} /> {incomplete ? 'Trotzdem übernehmen' : 'Übernehmen'}</button>
          </div>
        </div>
      )}

      <div className={`flex-shrink-0 border-t p-2 ${c.border}`}>
        <div className="flex items-end gap-1.5">
          <textarea value={input} rows={3} disabled={busy || accepting} placeholder={draft ? 'Weiter am Entwurf …' : p.placeholder}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
            className={`flex-1 resize-none text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`} />
          {busy ? (
            <button onClick={() => abort.current?.abort()} title="Anhalten" className={`p-2 rounded border ${c.btn}`}><CircleStop size={13} /></button>
          ) : (
            <button onClick={() => void ask(input)} disabled={!input.trim() || accepting} title="Senden (Enter)"
              className={`p-2 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}><SendIcon size={13} /></button>
          )}
        </div>
        <p className={`mt-1 text-[9px] leading-snug ${c.muted}`}>
          An Anthropic gehen nur die Spez (Seiten, Prozesse, Datenmodell, Service-Katalog) und dieser Chat – keine Kundendaten.
        </p>
      </div>
    </div>
  );
}

/** One line of the differences: kind, what, detail - a click selects it in the designer. */
export function ChangeLine({ isDark, kind, label, detail, onClick }: {
  isDark: boolean; kind: 'added' | 'removed' | 'changed' | 'moved' | 'page' | 'renamed'; label: string; detail?: string; onClick?: () => void;
}) {
  const c = cls(isDark);
  const text = { added: 'neu', removed: 'entfernt', changed: 'geändert', moved: 'verschoben', page: 'Seite', renamed: 'umbenannt' }[kind];
  return (
    <button onClick={onClick} className={`w-full text-left text-[10px] flex gap-1.5 ${c.text}`}>
      <span className={`w-16 flex-shrink-0 ${kind === 'removed' ? 'text-rose-500' : kind === 'added' ? 'text-emerald-500' : c.muted}`}>{text}</span>
      <span className="min-w-0">{label}{detail && <span className={c.muted}> – {detail}</span>}</span>
    </button>
  );
}
