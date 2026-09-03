// Kommentare an einem Element — Fäden mit Antworten, abhakbar.
//
// Bewusst schlicht: ein Feld zum Schreiben, darüber die Fäden. Erledigte
// rutschen nach unten und sind zugeklappt; weg sind sie nie, denn was
// besprochen wurde, ist selbst eine Auskunft.
import { useMemo, useState } from 'react';
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { addReply, addThread, removeThread, threadsFor, toggleResolved, whenLabel } from '../comments';
import type { CommentThread, ProcessSpec } from '../types';
import { cls } from '../ui';

export default function Comments({ spec, target, author, isDark, canEdit, onChange, title = 'Kommentare', highlight, threads }: {
  spec: ProcessSpec;
  target: string;
  author: string;
  isDark: boolean;
  canEdit: boolean;
  onChange: (spec: ProcessSpec) => void;
  title?: string;
  /** der Faden, auf dem die Navigation gerade steht */
  highlight?: string;
  /** Fäden direkt vorgeben (für die, deren Element es nicht mehr gibt) */
  threads?: CommentThread[];
}) {
  const c = cls(isDark);
  const [neu, setNeu] = useState('');
  const [antwortZu, setAntwortZu] = useState<string | null>(null);
  const [antwort, setAntwort] = useState('');

  const faeden = useMemo(() => {
    const alle = threads ?? threadsFor(spec, target);
    // offene zuerst; innerhalb dessen die zuletzt beschriebenen oben
    return [...alle].sort((a, b) => {
      if (!!a.resolved !== !!b.resolved) return a.resolved ? 1 : -1;
      return (letzter(b) ?? '').localeCompare(letzter(a) ?? '');
    });
  }, [spec, target, threads]);

  const offen = faeden.filter(t => !t.resolved).length;

  const schreiben = () => {
    if (!neu.trim()) return;
    onChange(addThread(spec, target, author, neu));
    setNeu('');
  };

  const antworten = (id: string) => {
    if (!antwort.trim()) return;
    onChange(addReply(spec, id, author, antwort));
    setAntwort('');
    setAntwortZu(null);
  };

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{title}</h3>
        {!!faeden.length && (
          <span className={`text-[10px] ${c.muted}`}>
            {offen ? `${offen} offen` : 'alle erledigt'}
            {faeden.length > offen ? ` · ${faeden.length - offen} erledigt` : ''}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {faeden.map(faden => (
          <Faden key={faden.id} faden={faden} isDark={isDark} canEdit={canEdit}
            hervorgehoben={faden.id === highlight}
            antwortOffen={antwortZu === faden.id}
            antwort={antwort}
            onAntwort={setAntwort}
            onAntwortOeffnen={() => { setAntwortZu(antwortZu === faden.id ? null : faden.id); setAntwort(''); }}
            onAntworten={() => antworten(faden.id)}
            onErledigt={() => onChange(toggleResolved(spec, faden.id))}
            onEntfernen={() => onChange(removeThread(spec, faden.id))} />
        ))}

        {canEdit && !threads && (
          <div className={`rounded border ${c.border2}`}>
            <textarea value={neu} onChange={e => setNeu(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) schreiben(); }}
              rows={neu ? 3 : 1}
              placeholder="Kommentar schreiben …"
              className={`w-full text-[11px] px-2 py-1.5 bg-transparent outline-none resize-y ${c.text}`} />
            {!!neu.trim() && (
              <div className={`flex items-center gap-2 px-2 py-1 border-t ${c.border2}`}>
                <span className={`text-[9px] ${c.muted}`}>{author} · ⌘↵</span>
                <button onClick={() => setNeu('')} className={`ml-auto text-[10px] ${c.muted} hover:underline`}>
                  Verwerfen
                </button>
                <button onClick={schreiben}
                  className={`text-[10px] px-2 py-1 rounded font-semibold ${c.btnPrimary}`}>
                  Kommentieren
                </button>
              </div>
            )}
          </div>
        )}

        {!canEdit && !faeden.length && (
          <p className={`text-[10px] ${c.muted}`}>Noch keine Kommentare.</p>
        )}
      </div>
    </div>
  );
}

const letzter = (t: CommentThread) => t.entries[t.entries.length - 1]?.at;

function Faden({ faden, isDark, canEdit, hervorgehoben, antwortOffen, antwort, onAntwort, onAntwortOeffnen, onAntworten, onErledigt, onEntfernen }: {
  faden: CommentThread;
  isDark: boolean;
  canEdit: boolean;
  hervorgehoben: boolean;
  antwortOffen: boolean;
  antwort: string;
  onAntwort: (t: string) => void;
  onAntwortOeffnen: () => void;
  onAntworten: () => void;
  onErledigt: () => void;
  onEntfernen: () => void;
}) {
  const c = cls(isDark);
  const [offen, setOffen] = useState(!faden.resolved);
  const erste = faden.entries[0];
  const weitere = faden.entries.slice(1);

  return (
    <div data-thread={faden.id}
      className={`rounded border transition-colors ${faden.resolved
        ? (isDark ? 'border-white/8 opacity-60' : 'border-black/8 opacity-60')
        : hervorgehoben
          ? (isDark ? 'border-white/40 bg-white/[0.07]' : 'border-black/40 bg-black/[0.05]')
          : c.border2}`}>
      <div className="flex items-start gap-1.5 px-2 py-1.5">
        <MessageSquare size={11} className={`mt-0.5 flex-shrink-0 ${c.muted}`} />
        <div className="min-w-0 flex-1">
          <div className={`flex items-baseline gap-1.5 text-[9px] ${c.muted}`}>
            <span className="font-semibold">{erste?.author}</span>
            <span>{erste ? whenLabel(erste.at) : ''}</span>
            {faden.resolved && <span className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>· erledigt</span>}
            {!!weitere.length && (
              <button onClick={() => setOffen(!offen)} className="ml-auto hover:underline">
                {offen ? 'Antworten ausblenden' : `${weitere.length} Antwort${weitere.length === 1 ? '' : 'en'}`}
              </button>
            )}
          </div>
          <p className={`text-[11px] whitespace-pre-wrap break-words ${c.text}`}>{erste?.text}</p>

          {offen && weitere.map(e => (
            <div key={e.id} className={`mt-1.5 pl-2 border-l ${c.border2}`}>
              <div className={`flex items-baseline gap-1.5 text-[9px] ${c.muted}`}>
                <span className="font-semibold">{e.author}</span>
                <span>{whenLabel(e.at)}</span>
              </div>
              <p className={`text-[11px] whitespace-pre-wrap break-words ${c.text}`}>{e.text}</p>
            </div>
          ))}

          {canEdit && (
            <div className="flex items-center gap-2 mt-1">
              <button onClick={onAntwortOeffnen} className={`text-[9px] ${c.muted} hover:underline`}>
                {antwortOffen ? 'Abbrechen' : 'Antworten'}
              </button>
              <button onClick={onErledigt}
                title={faden.resolved ? 'Wieder öffnen' : 'Als erledigt abhaken'}
                className={`flex items-center gap-1 text-[9px] ${c.muted} hover:underline`}>
                {faden.resolved ? <><RotateCcw size={9} /> Wieder öffnen</> : <><Check size={9} /> Erledigt</>}
              </button>
              <button onClick={onEntfernen} title="Faden entfernen" className={`ml-auto p-0.5 ${c.muted}`}>
                <Trash2 size={9} />
              </button>
            </div>
          )}

          {antwortOffen && canEdit && (
            <div className="mt-1 flex gap-1.5">
              <textarea value={antwort} onChange={e => onAntwort(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onAntworten(); }}
                rows={2} autoFocus placeholder="Antworten …"
                className={`flex-1 text-[11px] px-2 py-1 rounded border outline-none resize-y ${c.input}`} />
              <button onClick={onAntworten} disabled={!antwort.trim()}
                className={`self-end text-[10px] px-2 py-1 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>
                Antworten
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
