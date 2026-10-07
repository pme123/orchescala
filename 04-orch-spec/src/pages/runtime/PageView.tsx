import { Check, Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, type Gateway } from './gatewayTypes';
import { actionInput, errorText, evaluate, format, getPath, groupBy, interpolate, isEmail, resolve, setPath, type State } from './expr';
import type { Action, App, Component, Field, Page } from './spec';
import { cls } from './ui';

type Props = {
  page: Page;
  app: App;
  isDark: boolean;
  user?: { name?: string; email?: string; roles: string[] };
  /** Der Gateway - im Designer ein Ersatz mit Beispieldaten */
  gateway: Gateway;
  /** Im Designer: die Parameter der URL (z.B. token), die die Seite sieht */
  query?: Record<string, string>;
  /** Im Designer: ein Klick auf einen Baustein wählt ihn aus, der ausgewählte ist markiert */
  designer?: { selected?: string; onSelect: (key: string) => void };
};

/** Eine Seite der Spezifikation: ihr Zustand, ihre Aktionen und ihre Bausteine. */
export default function PageView({ page, app, isDark, user, gateway, query, designer }: Props) {
  const c = cls(isDark);
  const labels = app.labels ?? {};
  const [state, setState] = useState<State>(() => ({
    ...structuredClone(page.state ?? {}),
    query: query ?? Object.fromEntries(new URLSearchParams(window.location.search)),
    user,
  }));
  // die Aktionen laufen nacheinander und lesen den neuesten Zustand - nicht den des Renderns
  const latest = useRef(state);
  // nach dem Verlassen der Seite (oder einem neuen Stand im Designer): keine Aktion läuft weiter
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const update = (fn: (s: State) => State) => {
    if (!mounted.current) return;
    latest.current = fn(latest.current);
    setState(latest.current);
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // nach dem ersten Prüfen laufend markiert - ein ergänztes Feld ist sofort nicht mehr rot
  const [checked, setChecked] = useState(false);
  const missing = new Set(checked ? missingIn(page.body, state) : []);
  // ein verstecktes Feld - nur Bots füllen es aus (der Gateway lehnt sie dann ab)
  const [honeypot, setHoneypot] = useState('');
  const isPublic = page.access === 'public';
  // der Fehler einer Aktion - und, falls auch das scheiterte, der ihres onError
  const errorOf = (key: string) => [errors[key], errors[`${key}.onError`]].filter(Boolean).join(' – ');

  async function runOne(a: Action): Promise<void> {
    const s = latest.current;
    const input = (raw: unknown, pub?: boolean) => actionInput(raw, s, labels, !!pub, honeypot);
    const store = (path: string | undefined, value: unknown) => path && update((st) => setPath(st, path, value));
    // ein Business Key aus einer Vorlage, die leer bleibt: die Aktion schlägt fehl - eine Message
    // ohne Key fände ihre Instanz nicht, ein Start bekäme keinen
    const keyOf = (template: string | undefined, required: boolean): string | undefined => {
      if (template === undefined && !required) return undefined;
      const key = interpolate(template ?? '', s).trim();
      if (!key) throw new ApiError(400, `Business Key «${template ?? ''}» ist leer`);
      return key;
    };
    switch (a.do) {
      case 'set':
        // Vorlagen auch in Objekten und Listen - null bleibt null (ein Wert löschen)
        update((st) => setPath(st, a.path, a.value === null ? null : resolve(a.value, st, labels)));
        return;
      case 'call':
        store(a.result, await gateway.call(a.service, input(a.input, a.public), !!a.public));
        return;
      case 'start':
        store(
          a.result,
          await gateway.start(a.process, keyOf(a.businessKey, false), input(a.input, a.public), !!a.public),
        );
        return;
      case 'message':
        store(a.result, await gateway.message(a.name, keyOf(a.businessKey, true)!, input(a.input, a.public), !!a.public));
        return;
      case 'completeTask': {
        // wie der Business Key: ohne Task-ID ginge der Aufruf an /userTask/<key>//complete
        const taskId = interpolate(a.taskId, s).trim();
        if (!taskId) throw new ApiError(400, `Task-ID «${a.taskId}» ist leer`);
        await gateway.completeTask(a.taskKey, taskId, input(a.input));
        return;
      }
    }
  }

  /** Die Aktionen nacheinander - beim ersten Fehler Schluss, sein Text unter `key`. */
  async function run(actions: Action[], key: string): Promise<boolean> {
    setErrors((e) => ({ ...e, [key]: '' }));
    for (const a of actions) {
      if (!mounted.current) return false;
      try {
        await runOne(a);
      } catch (e) {
        if (!mounted.current) return false;
        const status = e instanceof ApiError ? e.status : 0;
        if (!(e instanceof ApiError)) console.error(e);
        // eine Anmeldung, die nicht geht (IdP weg, config.json fehlt), sagt das selbst - nicht «neu anmelden»
        const login = e instanceof ApiError && status === 401 && /Anmeldung/.test(e.message) ? e.message : null;
        setErrors((er) => ({ ...er, [key]: login ?? errorText(status || 503, 'errors' in a ? a.errors : undefined) }));
        if (a.do === 'call' && a.onError) await run(a.onError, `${key}.onError`);
        return false;
      }
    }
    return true;
  }

  // der Zustand `busy` gilt erst nach dem nächsten Rendern - ein Doppelklick startete sonst zweimal
  const inFlight = useRef(false);
  async function runBusy(actions: Action[], key: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(key);
    try {
      await run(actions, key);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !page.load) return; // StrictMode ruft Effekte zweimal - eine Message nur einmal
    loaded.current = true;
    void runBusy(page.load, 'load');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Die sichtbaren Pflichtangaben, die fehlen. */
  function missingIn(body: Component[], s: State): string[] {
    return body.flatMap((comp) => {
      if (!evaluate(comp.visible, s)) return [];
      switch (comp.type) {
        case 'section':
          return missingIn(comp.body, s);
        case 'fields':
          return comp.fields
            .filter((f) => evaluate(f.visible, s))
            .filter((f) => {
              const v = getPath(s, f.bind);
              const empty = v === undefined || v === null || String(v).trim() === '';
              return (f.required && empty) || (!empty && f.input === 'email' && !isEmail(String(v)));
            })
            .map((f) => f.bind);
        case 'choice':
        case 'pick':
          return comp.required && getPath(s, comp.bind) == null ? [comp.bind] : [];
        default:
          return [];
      }
    });
  }

  /** Ein Baustein - im Designer in einem Rahmen, der ihn bei einem Klick auswählt. */
  function render(comp: Component, key: string): React.ReactNode {
    const node = renderBlock(comp, key);
    if (!designer || node === null) return node;
    const selected = designer.selected === key;
    return (
      <div key={key} onClickCapture={() => designer.onSelect(key)}
        className={`-m-1 rounded p-1 outline-offset-2 transition-[outline-color] ${
          selected ? 'outline-2 outline-sky-500' : 'outline-1 outline-transparent hover:outline-dashed hover:outline-sky-400/60'}`}>
        {node}
      </div>
    );
  }

  function renderBlock(comp: Component, key: string): React.ReactNode {
    if (!evaluate(comp.visible, state)) return null;
    const text = (t: string) => interpolate(t, state, labels);
    switch (comp.type) {
      case 'heading':
        return <h1 key={key} className="text-lg font-bold tracking-wide">{text(comp.text)}</h1>;
      case 'text': {
        const tone = comp.tone ?? 'muted';
        const box = tone === 'muted' ? '' : `rounded-lg border px-4 py-3 ${c[tone]}`;
        return (
          <p key={key} className={`text-sm leading-relaxed whitespace-pre-line ${tone === 'muted' ? c.muted2 : box}`}>
            {tone === 'success' && <Check size={14} className="mr-2 inline" />}
            {tone === 'error' && <TriangleAlert size={14} className="mr-2 inline" />}
            {text(comp.text)}
          </p>
        );
      }
      case 'choice': {
        const value = getPath(state, comp.bind);
        return (
          <div key={key} className="space-y-2">
            {comp.label && <Label text={text(comp.label)} missing={missing.has(comp.bind)} isDark={isDark} />}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {comp.options.map((o, i) => {
                const selected = JSON.stringify(o.value) === JSON.stringify(value);
                return (
                  <button key={i} type="button" disabled={busy !== null}
                    onClick={() => {
                      update((s) => setPath(s, comp.bind, o.value));
                      if (comp.onChange) void runBusy(comp.onChange, key);
                    }}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${selected ? c.selected : `${c.border2} ${c.hover}`}`}>
                    <div className="font-bold">{o.label}</div>
                    {o.hint && <div className={`mt-0.5 text-[10px] ${c.muted}`}>{o.hint}</div>}
                  </button>
                );
              })}
            </div>
            {errorOf(key) && <Alert text={errorOf(key)} isDark={isDark} />}
          </div>
        );
      }
      case 'pick': {
        const items = getPath(state, comp.items);
        const value = JSON.stringify(getPath(state, comp.bind));
        const list = Array.isArray(items) ? items : [];
        const groups = comp.groupBy
          ? groupBy(list, (i) => format(getPath(i, comp.groupBy!.path), comp.groupBy!.format, labels))
          : [{ key: '', items: list }];
        return (
          <div key={key} className="space-y-2">
            {comp.label && <Label text={text(comp.label)} missing={missing.has(comp.bind)} isDark={isDark} />}
            {busy !== null && !Array.isArray(items) ? (
              <Loader2 size={14} className={`animate-spin ${c.muted}`} />
            ) : list.length === 0 ? (
              <p className={`text-xs ${c.muted}`}>{comp.empty ? text(comp.empty) : 'Keine Einträge.'}</p>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <div key={g.key}>
                    {g.key && <div className={`mb-1 text-[10px] font-bold tracking-widest uppercase ${c.muted}`}>{g.key}</div>}
                    <div className="flex flex-wrap gap-2">
                      {g.items.map((item, i) => {
                        const selected = JSON.stringify(item) === value;
                        return (
                          <button key={i} type="button" disabled={busy !== null} onClick={() => update((s) => setPath(s, comp.bind, item))}
                            className={`rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${selected ? c.selected : `${c.border2} ${c.hover}`}`}>
                            <div className="font-bold">{interpolate(comp.itemLabel, item, labels)}</div>
                            {comp.itemHint && <div className={`text-[10px] ${c.muted}`}>{interpolate(comp.itemHint, item, labels)}</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }
      case 'fields':
        return (
          <div key={key} className="space-y-2">
            {comp.label && <Label text={text(comp.label)} isDark={isDark} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {comp.fields.filter((f) => evaluate(f.visible, state)).map((f) => (
                <FieldInput key={f.bind} field={f} isDark={isDark} missing={missing.has(f.bind)} disabled={busy !== null}
                  value={String(getPath(state, f.bind) ?? '')}
                  onChange={(v) => update((s) => setPath(s, f.bind, v))} />
              ))}
            </div>
          </div>
        );
      case 'summary':
        return (
          <div key={key} className="space-y-2">
            {comp.label && <Label text={text(comp.label)} isDark={isDark} />}
            <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border px-4 py-3 text-xs ${c.border} ${c.panel}`}>
              {comp.items.filter((i) => evaluate(i.visible, state)).map((i) => (
                <div key={i.label} className="contents">
                  <dt className={c.muted}>{text(i.label)}</dt>
                  <dd className="whitespace-pre-line">{text(i.value) || '–'}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      case 'button': {
        const running = busy === key;
        return (
          <div key={key} className="space-y-2">
            <button type="button" disabled={busy !== null}
              onClick={() => {
                if (comp.validate) {
                  const absent = missingIn(page.body, latest.current);
                  setChecked(true);
                  if (absent.length > 0) {
                    setErrors((e) => ({ ...e, [key]: 'Bitte die markierten Angaben ergänzen.' }));
                    return;
                  }
                }
                void runBusy(comp.actions, key);
              }}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold tracking-wide transition-colors disabled:opacity-50 ${comp.secondary ? c.btn : `border-transparent ${c.btnPrimary}`}`}>
              {running && <Loader2 size={12} className="animate-spin" />}
              {text(comp.label)}
            </button>
            {errorOf(key) && <Alert text={errorOf(key)} isDark={isDark} />}
          </div>
        );
      }
      case 'section':
        return (
          <section key={key} className={`space-y-4 rounded-xl border p-5 ${c.border} ${c.panel}`}>
            {comp.label && <div className={`text-[10px] font-bold tracking-widest uppercase ${c.title}`}>{text(comp.label)}</div>}
            {comp.body.map((b, i) => render(b, `${key}.${i}`))}
          </section>
        );
      case 'loading':
        return busy === 'load' ? (
          <div key={key} className={`flex items-center gap-2 text-xs ${c.muted}`}>
            <Loader2 size={14} className="animate-spin" /> {comp.text ? text(comp.text) : 'Einen Moment …'}
          </div>
        ) : null;
      default:
        // ein Baustein, den dieser Renderer nicht kennt (eine neuere Seite) - weglassen statt abstürzen
        return null;
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-3xl space-y-5 p-6">
      {isPublic && (
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0" />
      )}
      {errorOf('load') && <Alert text={errorOf('load')} isDark={isDark} />}
      {page.body.map((comp, i) => render(comp, String(i)))}
    </div>
  );
}

function Label({ text, missing, isDark }: { text: string; missing?: boolean; isDark: boolean }) {
  const c = cls(isDark);
  return (
    <div className={`text-[10px] font-bold tracking-widest uppercase ${missing ? 'text-rose-500' : c.title}`}>{text}</div>
  );
}

/** Ein Eingabefeld - `disabled`, solange Aktionen laufen: sie lesen den Zustand nacheinander, er soll derselbe bleiben. */
function FieldInput({ field, value, onChange, missing, isDark, disabled }: {
  field: Field; value: string; onChange: (v: string) => void; missing: boolean; isDark: boolean; disabled: boolean;
}) {
  const c = cls(isDark);
  const base = `w-full rounded-lg border px-3 py-2 text-xs outline-none transition-colors ${c.input} ${missing ? '!border-rose-500' : ''}`;
  return (
    <label className={`block space-y-1 ${field.input === 'textarea' ? 'sm:col-span-2' : ''}`}>
      <span className={`text-[10px] ${missing ? 'text-rose-500' : c.muted2}`}>
        {field.label}
        {field.required && ' *'}
      </span>
      {field.input === 'textarea' ? (
        <textarea rows={3} value={value} disabled={disabled} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} className={base} />
      ) : (
        <input type={field.input ?? 'text'} value={value} disabled={disabled} placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)} className={base} />
      )}
    </label>
  );
}

function Alert({ text, isDark }: { text: string; isDark: boolean }) {
  const c = cls(isDark);
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${c.error}`}>
      <TriangleAlert size={13} className="mt-0.5 flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}
