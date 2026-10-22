// The chat of the AI mode in the process view (stage B): Claude changes a draft of the process -
// diagram and spec (processTools.ts). The view shows the draft (diagram and flow); accepting it goes the
// way of a change in the diagram, with its own source «KI» in the change log, and can be undone once.
import { useMemo } from 'react';
import { targetsOf } from '../pages/designer/model';
import type { Model, ProcessSpec } from '../types';
import { AiChat, ChangeLine, type AcceptOutcome } from './AiChat';
import { processPrompt, processSystem } from './context';
import { processDiff } from './diff';
import { processDraftChanged, processToolKit, startProcessDraft, type ProcessDraft } from './processTools';

export function ProcessAiPanel({ isDark, apiKey, spec, xml, model, specs, draft, onDraft, onAccept, undo, onSelect }: {
  isDark: boolean;
  apiKey: string;
  /** the process as it is saved (without the draft) */
  spec: ProcessSpec;
  xml: string;
  model: Model | null;
  /** all processes of the folder - their keys for the data model */
  specs: ProcessSpec[];
  draft: ProcessDraft | null;
  onDraft: (d: ProcessDraft | null) => void;
  onAccept: (d: ProcessDraft, requests: string[]) => Promise<AcceptOutcome>;
  undo: { label: string; run: () => void } | null;
  onSelect: (id: string) => void;
}) {
  const changes = useMemo(() => (draft ? processDiff(draft.base.spec, draft.spec) : []), [draft]);
  // all workers of the domain - also those of the processes (targetsOf without specs keeps them)
  const targets = useMemo(() => ({ ...(model ? targetsOf(model, []) : { services: [], messages: [], userTasks: [] }), processes: model ? targetsOf(model, specs).processes : [] }), [model, specs]);
  return (
    <AiChat<ProcessDraft> isDark={isDark} apiKey={apiKey} draft={draft} onDraft={onDraft}
      system={() => processSystem({ ...targets, messages: [], userTasks: [] })}
      kit={processToolKit({ model })}
      start={() => startProcessDraft(spec, xml)}
      changed={processDraftChanged}
      openPoints={(d) => d.openPoints}
      firstPrompt={(text) => processPrompt(spec.title, spec.processId ?? spec.slug, text)}
      onAccept={onAccept}
      undo={undo}
      acceptedText="Übernommen – im Verlauf als «KI (Claude)»."
      placeholder="Was soll sich am Ablauf ändern?"
      hint={<>
        <p>Beschreibe, was sich am Ablauf ändern soll – z.B. «Nach der Prüfung soll das Backoffice die neue Adresse freigeben; ist sie ungültig, wird der Kunde informiert».</p>
        <p>Claude ändert Diagramm und Spez als Entwurf und prüft ihn mit den Befunden. Du siehst ihn im Diagramm und im Ablauf und übernimmst oder verwirfst ihn.</p>
      </>}
      changes={changes.length ? changes.map((ch, i) => (
        <ChangeLine key={i} isDark={isDark} kind={ch.kind} label={ch.label} detail={ch.detail}
          onClick={ch.kind !== 'removed' ? () => onSelect(ch.id) : undefined} />
      )) : <span className="text-[10px] opacity-60">nur das Diagramm (Lage, Verbindungen)</span>} />
  );
}
