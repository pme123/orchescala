// The chat of the AI mode in the page designer (stage A). The RE writes what they want; Claude changes a
// draft of the page (pageTools.ts) and corrects it until the designer's findings show no errors of its
// own. The preview shows the draft with the same renderer; the RE accepts it - like a change by hand,
// one step of undo - or discards it. Only shown with a key (E20): the designer mounts it only then.
import type { BetaMessageParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { AlertTriangle, Check, CircleStop, Info, Loader2, MessageSquarePlus, Send as SendIcon, Sparkles, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import specSource from '../pages/runtime/spec.ts?raw';
import type { BlockKey, Targets } from '../pages/designer/model';
import type { App, Page } from '../pages/runtime/spec';
import { cls } from '../ui';
import { runTurn, type AgentEvent, type Stop } from './agent';
import { claudeSender, errorText } from './client';
import { pagePrompt, pageSystem } from './context';
import { addUsage, NO_USAGE, usageLine, type Usage } from './cost';
import { pageDiff, type PageChange } from './diff';
import { draftChanged, pageToolKit, startDraft, type PageDraft } from './pageTools';

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'claude'; text: string }
  | { kind: 'tool'; text: string; isError: boolean }
  | { kind: 'check'; errors: string[] }
  | { kind: 'done'; usage: Usage; stop: Stop; errors: string[]; openPoints: string[]; changed: boolean }
  | { kind: 'note'; text: string; tone?: 'error' | 'ok' };

const STOP_TEXT: Partial<Record<Stop, string>> = {
  max_steps: 'Claude hat zu viele Schritte gebraucht und wurde angehalten.',
  max_tokens: 'Die Antwort war zu lang und wurde abgeschnitten.',
  refusal: 'Claude hat die Anfrage abgelehnt.',
  cancelled: 'Abgebrochen.',
};

const CHANGE_TEXT: Record<PageChange['kind'], string> = { added: 'neu', removed: 'entfernt', changed: 'geändert', moved: 'verschoben', page: 'Seite' };

export function AiPanel({ isDark, apiKey, slug, page, pages, app, targets, draft, onDraft, onAccept, onSelect, initialPrompt }: {
  isDark: boolean;
  apiKey: string;
  slug: string;
  /** the page as it is saved (without the draft) */
  page: Page;
  /** all pages of the app - this one in its current state */
  pages: { slug: string; page: Page }[];
  app: App | undefined;
  targets: Targets;
  draft: PageDraft | null;
  onDraft: (d: PageDraft | null) => void;
  onAccept: (page: Page) => void;
  onSelect: (key: BlockKey) => void;
  /** a request that starts at once - from «Neue Seite» with a description */
  initialPrompt?: string;
}) {
  const c = cls(isDark);
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
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const add = (...e: Entry[]) => setEntries((list) => [...list, ...e]);
  const changes = useMemo(() => (draft ? pageDiff(draft.base, draft.page) : []), [draft]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [entries, busy]);
  // leaving the page or deleting the key stops a running request
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    const others = pages.filter((p) => p.slug !== slug);
    const sys = system.current ?? pageSystem(specSource, targets, [...others, { slug, page }], app);
    system.current = sys;
    const prompt = pagePrompt(slug, [note.current, text.trim()].filter(Boolean).join('\n\n'), history.current.length === 0);
    note.current = null;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setInput('');
    add({ kind: 'user', text: text.trim() });
    const onEvent = (e: AgentEvent) => {
      if (e.kind === 'text') add({ kind: 'claude', text: e.text });
      else if (e.kind === 'tool') add({ kind: 'tool', text: e.summary, isError: e.isError });
      else if (e.kind === 'check') add({ kind: 'check', errors: e.errors });
      else setLive(e.usage);
    };
    const r = await runTurn({
      send: claudeSender(apiKey), system: sys, kit: pageToolKit({ targets, others: [...others, { slug, page }] }),
      history: history.current, prompt, draft: draft ?? startDraft(slug, page), onEvent, signal: controller.signal,
    });
    history.current = r.history;
    abort.current = null;
    setBusy(false);
    setLive(null);
    setTotal((t) => addUsage(t, r.usage));
    const changed = draftChanged(r.draft);
    onDraft(changed ? r.draft : null);
    add(
      ...(r.stop === 'error' ? [{ kind: 'note' as const, text: errorText(r.error), tone: 'error' as const }] : []),
      ...(STOP_TEXT[r.stop] ? [{ kind: 'note' as const, text: STOP_TEXT[r.stop]!, tone: 'error' as const }] : []),
      { kind: 'done', usage: r.usage, stop: r.stop, errors: r.errors, openPoints: r.draft.openPoints.filter((p) => !draft?.openPoints.includes(p)), changed },
    );
    // eslint-disable-next-line no-console -- for measuring the costs of the PoC
    console.info('[orch-spec KI]', usageLine(r.usage), r.usage);
  };

  // «Neue Seite» with a description: start right away, once
  const started = useRef(false);
  useEffect(() => {
    if (initialPrompt && !started.current) { started.current = true; void ask(initialPrompt); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const accept = () => {
    if (!draft) return;
    onAccept(draft.page);
    onDraft(null);
    note.current = 'Der RE hat deinen Entwurf übernommen – er ist jetzt die Seite.';
    add({ kind: 'note', text: 'Übernommen – rückgängig mit ⌘Z.', tone: 'ok' });
  };
  const discard = () => {
    onDraft(null);
    note.current = 'Der RE hat deinen letzten Entwurf verworfen – die Seite ist wieder wie vor deinen Änderungen.';
    add({ kind: 'note', text: 'Verworfen – die Seite ist wie vorher.' });
  };
  const restart = () => {
    abort.current?.abort();
    history.current = [];
    system.current = null;
    note.current = null;
    onDraft(null);
    setEntries([]);
    setTotal(NO_USAGE);
  };

  const tone = (t?: 'error' | 'ok') => (t === 'error' ? (isDark ? 'text-rose-300' : 'text-rose-700') : t === 'ok' ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : c.muted2);

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
        {entries.length === 0 && (
          <div className={`space-y-2 ${c.muted}`}>
            <p>Beschreibe, was sich an der Seite ändern soll – z.B. «Nimm im Formular ein Feld für die bevorzugte Filiale auf».</p>
            <p>Claude ändert einen Entwurf und prüft ihn mit den Befunden des Designers. Du siehst ihn in der Vorschau und übernimmst oder verwirfst ihn.</p>
          </div>
        )}
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
                      Offene Punkte (für die Entwicklung):{e.openPoints.map((p, j) => <div key={j} className="ml-2">· {p}</div>)}
                    </div>
                  )}
                  {!e.changed && e.stop === 'done' && <div className={c.muted}>Keine Änderung an der Seite.</div>}
                  <div className={c.muted} title="Tokens und Kosten dieser Änderung (Claude Opus 5.5, Preise Oktober 2026)">{usageLine(e.usage)}</div>
                </div>
              );
            case 'note':
              return <div key={i} className={`flex items-start gap-1.5 text-[10px] ${tone(e.tone)}`}><Info size={10} className="mt-0.5 flex-shrink-0" />{e.text}</div>;
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
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {changes.map((ch, i) => (
              <button key={i} onClick={() => ch.key !== undefined && ch.kind !== 'removed' && onSelect(ch.key)}
                className={`w-full text-left text-[10px] flex gap-1.5 ${c.text}`}>
                <span className={`w-16 flex-shrink-0 ${ch.kind === 'removed' ? 'text-rose-500' : ch.kind === 'added' ? 'text-emerald-500' : c.muted}`}>{CHANGE_TEXT[ch.kind]}</span>
                <span className="min-w-0">{ch.label}{ch.detail && <span className={c.muted}> – {ch.detail}</span>}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={discard} className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}><X size={11} /> Verwerfen</button>
            <button onClick={accept} className={`ml-auto flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border border-transparent ${c.btnPrimary}`}><Check size={11} /> Übernehmen</button>
          </div>
        </div>
      )}

      <div className={`flex-shrink-0 border-t p-2 ${c.border}`}>
        <div className="flex items-end gap-1.5">
          <textarea value={input} rows={3} disabled={busy} placeholder={draft ? 'Weiter am Entwurf …' : 'Was soll sich ändern?'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
            className={`flex-1 resize-none text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`} />
          {busy ? (
            <button onClick={() => abort.current?.abort()} title="Anhalten" className={`p-2 rounded border ${c.btn}`}><CircleStop size={13} /></button>
          ) : (
            <button onClick={() => void ask(input)} disabled={!input.trim()} title="Senden (Enter)"
              className={`p-2 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}><SendIcon size={13} /></button>
          )}
        </div>
        <p className={`mt-1 text-[9px] leading-snug ${c.muted}`}>
          An Anthropic gehen nur die Spez (Seiten, Datenmodell, Service-Katalog) und dieser Chat – keine Kundendaten.
        </p>
      </div>
    </div>
  );
}
