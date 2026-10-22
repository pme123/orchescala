// The keys of the page designer: which key does what - pure, so that it can be tested (PageEditor calls
// it with the KeyboardEvent and executes what comes out).

export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'defaultPrevented'>;

export type DesignerKey = 'undo' | 'redo' | 'deselect' | 'remove' | 'duplicate' | 'up' | 'down';

/** What a key does in the designer - null: nothing, the browser keeps it (also its ⌘D, its ⌘Z).
  * @param inField in the field, in a dialog above it: there it belongs to the field
  * @param canEdit without write permission only Esc - otherwise the designer would swallow the browser's ⌘Z and ⌘D
  * @param hasBlock a block is selected (Del, ⌘D, ⌥↑↓ act on it) - Del deletes it where the focus
  *   is not in a field (also on a button of the outline: there it is selected)
  * @param can whether there is something to undo / redo - otherwise ⌘Z stays with the browser */
export function designerKey(
  e: KeyLike, inField: boolean, canEdit: boolean, hasBlock: boolean, can = { undo: true, redo: true },
): { action: DesignerKey; run: boolean } | null {
  if (e.defaultPrevented || inField) return null;
  if (e.key === 'Escape') return { action: 'deselect', run: true };
  if (!canEdit) return null;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  // ⌘Z repeats when held down (the steps read the latest state)
  const undoRedo = (action: 'undo' | 'redo') => (can[action] ? { action, run: true } : null);
  if (mod && k === 'z') return undoRedo(e.shiftKey ? 'redo' : 'undo');
  if (mod && k === 'y') return undoRedo('redo');
  if (!hasBlock) return null;
  // only Del - Backspace on a button or the page would otherwise delete unintentionally
  const action: DesignerKey | null = e.key === 'Delete' ? 'remove'
    : mod && k === 'd' ? 'duplicate'
    : e.altKey && e.key === 'ArrowUp' ? 'up'
    : e.altKey && e.key === 'ArrowDown' ? 'down'
    : null;
  // held down: one step per press - the actions know the block of the last render, after
  // a move it is somewhere else; the key still stays with the designer (run: false)
  return action && { action, run: !e.repeat };
}
