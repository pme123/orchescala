// Where the building blocks and actions of a page are - the one traversal for the designer model and
// for the task links. Kept light (no designer code), because the process view uses it too.
import type { Action, Component, Page } from './runtime/spec';

/** The key of a building block: its index path in `body` - `"2"`, `"2.1"` (in a section). */
export type BlockKey = string;

/** Every building block with its key - depth first, as the outline shows them. */
export function flatten(body: Component[], prefix = ''): { key: BlockKey; block: Component; depth: number }[] {
  return body.flatMap((block, i) => {
    const key = prefix ? `${prefix}.${i}` : String(i);
    const self = { key, block, depth: prefix ? prefix.split('.').length : 0 };
    return block.type === 'section' ? [self, ...flatten(block.body, key)] : [self];
  });
}

/** Every action of a page with its location - load, a button, onChange, onError. */
export function actionsOf(page: Page): { where: string; key?: BlockKey; action: Action }[] {
  const nested = (where: string, actions: Action[] | undefined, key?: BlockKey): { where: string; key?: BlockKey; action: Action }[] =>
    (actions ?? []).flatMap((action) => [
      { where, key, action },
      ...('onError' in action ? nested(`${where} (onError)`, action.onError, key) : []),
    ]);
  return [
    ...nested('Laden', page.load),
    ...flatten(page.body).flatMap(({ key, block }) =>
      block.type === 'button'
        ? nested(`Button «${block.label}»`, block.actions, key)
        : block.type === 'choice'
          ? nested(`Auswahl «${block.label ?? block.bind}»`, block.onChange, key)
          : [],
    ),
  ];
}
