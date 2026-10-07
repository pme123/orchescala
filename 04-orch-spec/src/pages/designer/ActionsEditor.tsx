// Die Aktionen einer Seite (beim Laden, eines Buttons, bei einer Änderung) - jede mit den Services,
// Prozessen, Messages und Benutzer-Tasks, die der Katalog und die Prozess-Specs kennen.
import { Wand2 } from 'lucide-react';
import type { Action, Errors } from '../runtime/spec';
import { cls } from '../../ui';
import { CheckField, JsonField, PathField, RowList, SelectField, TextField } from './fields';
import { inputSkeleton, type Targets } from './model';

type Kind = Action['do'];

const KINDS: { value: Kind; label: string }[] = [
  { value: 'call', label: 'Service aufrufen' },
  { value: 'start', label: 'Prozess starten' },
  { value: 'message', label: 'Message senden' },
  { value: 'completeTask', label: 'Benutzer-Task abschliessen' },
  { value: 'set', label: 'Wert setzen' },
];

function newAction(kind: Kind, targets: Targets): Action {
  switch (kind) {
    case 'call':
      return { do: 'call', service: targets.services[0]?.topic ?? '', result: 'result' };
    case 'start':
      return { do: 'start', process: targets.processes[0]?.key ?? '' };
    case 'message':
      return { do: 'message', name: targets.messages[0]?.name ?? '', businessKey: '{{query.token}}' };
    case 'completeTask':
      return { do: 'completeTask', taskKey: targets.userTasks[0]?.key ?? '', taskId: '{{task.taskId}}' };
    case 'set':
      return { do: 'set', path: 'step', value: 'done' };
  }
}

export default function ActionsEditor({ isDark, actions, onChange, targets, paths, nested, addLabel = 'Aktion' }: {
  isDark: boolean; actions: Action[] | undefined; onChange: (a: Action[]) => void; targets: Targets; paths: string[];
  nested?: boolean; addLabel?: string;
}) {
  return (
    <RowList isDark={isDark} items={actions ?? []} onChange={onChange} addLabel={addLabel}
      empty="Keine Aktionen."
      add={() => newAction('set', targets)}
      render={(a, set) => <ActionForm isDark={isDark} action={a} onChange={set} targets={targets} paths={paths} nested={nested} />} />
  );
}

function ActionForm({ isDark, action: a, onChange, targets, paths, nested }: {
  isDark: boolean; action: Action; onChange: (a: Action) => void; targets: Targets; paths: string[]; nested?: boolean;
}) {
  const c = cls(isDark);
  const prefill = (fields: { name: string }[] | undefined) =>
    fields && fields.length > 0 ? (
      <button onClick={() => onChange({ ...a, input: inputSkeleton(fields as never) } as Action)}
        title="Jedes Feld des In-Typs mit {{feld}} - danach anpassen"
        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
        <Wand2 size={10} /> Eingabe vorbelegen
      </button>
    ) : null;
  // jede Aktion ausser «Wert setzen» kann scheitern - auch eine neue ohne Texte
  // und danach weitere Aktionen (nicht verschachtelt: ein onError hat kein eigenes)
  const errors = a.do !== 'set' ? (
    <>
      <ErrorsEditor isDark={isDark} errors={a.errors} onChange={(errors) => onChange({ ...a, errors } as Action)} />
      {!nested && (
        <details>
          <summary className={`text-[10px] cursor-pointer ${c.muted2}`}>Bei einem Fehler zusätzlich ({a.onError?.length ?? 0})</summary>
          <div className="pt-2">
            <ActionsEditor isDark={isDark} actions={a.onError} nested targets={targets} paths={paths}
              onChange={(onError) => onChange({ ...a, onError: onError.length ? onError : undefined } as Action)} />
          </div>
        </details>
      )}
    </>
  ) : null;

  return (
    <div className="space-y-2">
      <SelectField isDark={isDark} label="Aktion" value={a.do} options={KINDS}
        onChange={(kind) => kind !== a.do && onChange(newAction(kind, targets))} />
      {a.do === 'call' && (
        <>
          <SelectField isDark={isDark} label="Service" value={a.service}
            options={targets.services.map((s) => ({ value: s.topic, label: s.topic }))}
            onChange={(service) => onChange({ ...a, service })} />
          {(() => {
            const svc = targets.services.find((s) => s.topic === a.service);
            return svc?.descr ? <p className={`text-[10px] ${c.muted}`}>{svc.descr}</p> : null;
          })()}
          <CheckField isDark={isDark} label="ohne Login (/public - der Gateway muss ihn freigeben)" checked={a.public}
            onChange={(pub) => onChange({ ...a, public: pub || undefined })} />
          <JsonField isDark={isDark} label="Eingabe" value={a.input} onChange={(input) => onChange({ ...a, input })} />
          {prefill(targets.services.find((s) => s.topic === a.service)?.in)}
          <PathField isDark={isDark} label="Ergebnis nach" hint="ein Pfad im Zustand" value={a.result} suggestions={paths}
            onChange={(result) => onChange({ ...a, result: result || undefined })} />
          {errors}
        </>
      )}
      {a.do === 'start' && (
        <>
          <SelectField isDark={isDark} label="Prozess" value={a.process}
            options={targets.processes.map((p) => ({ value: p.key, label: `${p.title} – ${p.key}` }))}
            onChange={(process) => onChange({ ...a, process })} />
          <CheckField isDark={isDark} label="ohne Login (/public)" checked={a.public} onChange={(pub) => onChange({ ...a, public: pub || undefined })} />
          <TextField isDark={isDark} label="Business Key" hint="öffentlich: mindestens 16 Zeichen, unerratbar" mono value={a.businessKey}
            onChange={(businessKey) => onChange({ ...a, businessKey: businessKey || undefined })} />
          <JsonField isDark={isDark} label="Eingabe (In des Prozesses)" value={a.input} onChange={(input) => onChange({ ...a, input })} />
          {prefill(targets.processes.find((p) => p.key === a.process)?.in)}
          <PathField isDark={isDark} label="Ergebnis nach" value={a.result} suggestions={paths}
            onChange={(result) => onChange({ ...a, result: result || undefined })} />
          {errors}
        </>
      )}
      {a.do === 'message' && (
        <>
          <SelectField isDark={isDark} label="Message" value={a.name}
            options={targets.messages.map((m) => ({ value: m.name, label: m.name }))}
            onChange={(name) => onChange({ ...a, name })} />
          <CheckField isDark={isDark} label="ohne Login (/public)" checked={a.public} onChange={(pub) => onChange({ ...a, public: pub || undefined })} />
          <TextField isDark={isDark} label="Business Key" hint="ordnet die Message der Instanz zu" mono value={a.businessKey}
            onChange={(businessKey) => onChange({ ...a, businessKey })} />
          <JsonField isDark={isDark} label="Eingabe" value={a.input} onChange={(input) => onChange({ ...a, input })} />
          {prefill(targets.messages.find((m) => m.name === a.name)?.in)}
          {errors}
        </>
      )}
      {a.do === 'completeTask' && (
        <>
          <SelectField isDark={isDark} label="Benutzer-Task" value={a.taskKey}
            options={targets.userTasks.map((t) => ({ value: t.key, label: `${t.name} – ${t.key}` }))}
            onChange={(taskKey) => onChange({ ...a, taskKey })} />
          <TextField isDark={isDark} label="Task-ID" hint="aus dem Zustand" mono value={a.taskId} onChange={(taskId) => onChange({ ...a, taskId })} />
          <JsonField isDark={isDark} label="Ergebnis des Tasks (Out)" value={a.input} onChange={(input) => onChange({ ...a, input })} />
          {prefill(targets.userTasks.find((t) => t.key === a.taskKey)?.out)}
          {errors}
        </>
      )}
      {a.do === 'set' && (
        <>
          <PathField isDark={isDark} label="Pfad" value={a.path} suggestions={paths} onChange={(path) => onChange({ ...a, path })} />
          <JsonField isDark={isDark} label="Wert" rows={1} value={a.value} onChange={(value) => onChange({ ...a, value })} />
        </>
      )}
    </div>
  );
}

/** Die Fehlertexte nach HTTP-Status - der Gateway gibt anonymen Aufrufern nur den Status. */
function ErrorsEditor({ isDark, errors, onChange }: { isDark: boolean; errors: Errors | undefined; onChange: (e: Errors | undefined) => void }) {
  const c = cls(isDark);
  const rows = Object.entries(errors ?? {}).map(([status, text]) => ({ status, text }));
  return (
    <details>
      <summary className={`text-[10px] cursor-pointer ${c.muted2}`}>Fehlertexte ({rows.length})</summary>
      <div className="pt-2">
        <RowList isDark={isDark} items={rows} addLabel="Fehlertext"
          add={() => ({ status: rows.some((r) => r.status === 'default') ? '400' : 'default', text: '' })}
          onChange={(next) => onChange(next.length ? Object.fromEntries(next.map((r) => [r.status, r.text])) : undefined)}
          render={(r, set) => (
            <div className="grid grid-cols-[5rem_1fr] gap-2">
              <TextField isDark={isDark} label="Status" mono value={r.status} placeholder="409" onChange={(status) => set({ ...r, status })} />
              <TextField isDark={isDark} label="Text" value={r.text} onChange={(text) => set({ ...r, text })} />
            </div>
          )} />
      </div>
    </details>
  );
}
