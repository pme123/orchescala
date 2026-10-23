// The chat of the AI mode in the page designer (stage A): Claude changes a draft of the page
// (pageTools.ts); accepting it is one step of undo in the designer - like a change by hand.
import { useMemo } from 'react';
import specSource from '../pages/runtime/spec.ts?raw';
import type { BlockKey, Targets } from '../pages/designer/model';
import type { App, Page } from '../pages/runtime/spec';
import { AiChat, ChangeLine, type AcceptOutcome } from './AiChat';
import { pagePrompt, pageSystem } from './context';
import { pageDiff } from './diff';
import { draftChanged, pageToolKit, startDraft, type PageDraft } from './pageTools';

export function AiPanel({ isDark, apiKey, slug, page, pages, app, targets, draft, onDraft, onAccept, onSelect, initialPrompt, onInitialPrompt }: {
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
  onInitialPrompt?: () => void;
}) {
  const changes = useMemo(() => (draft ? pageDiff(draft.base, draft.page) : []), [draft]);
  const all = [...pages.filter((p) => p.slug !== slug), { slug, page }];
  return (
    <AiChat<PageDraft> isDark={isDark} apiKey={apiKey} draft={draft} onDraft={onDraft} initialPrompt={initialPrompt} onInitialPrompt={onInitialPrompt}
      system={() => pageSystem(specSource, targets, all, app)}
      kit={pageToolKit({ targets, others: all })}
      start={() => startDraft(slug, page)}
      changed={draftChanged}
      openPoints={(d) => d.openPoints}
      firstPrompt={(text) => pagePrompt(slug, text, true)}
      onAccept={(d): AcceptOutcome => {
        // the page changed since the draft began (reloaded) - taking the draft over would overwrite that
        if (JSON.stringify(page) !== JSON.stringify(d.base))
          return { refused: 'Die Seite hat sich seit dem Entwurf geändert (neu geladen) – Entwurf verwerfen und Claude nochmals fragen.' };
        onAccept(d.page);
      }}
      acceptedText="Übernommen – rückgängig mit ⌘Z."
      placeholder="Was soll sich ändern?"
      hint={<>
        <p>Beschreibe, was sich an der Seite ändern soll – z.B. «Nimm im Formular ein Feld für die bevorzugte Filiale auf».</p>
        <p>Claude ändert einen Entwurf und prüft ihn mit den Befunden des Designers. Du siehst ihn in der Vorschau und übernimmst oder verwirfst ihn.</p>
      </>}
      changes={changes.map((ch, i) => (
        <ChangeLine key={i} isDark={isDark} kind={ch.kind} label={ch.label} detail={ch.detail}
          onClick={ch.key !== undefined && ch.kind !== 'removed' ? () => onSelect(ch.key!) : undefined} />
      ))} />
  );
}
