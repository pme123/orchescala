// Die Tasten des Seiten-Designers: welche Taste was tut - rein, damit es sich prüfen lässt (PageEditor ruft
// es mit dem KeyboardEvent auf und führt aus, was herauskommt).

export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'defaultPrevented'>;

export type DesignerKey = 'undo' | 'redo' | 'deselect' | 'remove' | 'duplicate' | 'up' | 'down';

/** Was eine Taste im Designer tut - null: nichts, der Browser behält sie (auch ihr ⌘D, ihr ⌘Z).
  * @param inField im Feld, in einem Dialog darüber: dort gehört sie dem Feld
  * @param canEdit ohne Schreibrecht nur Esc - sonst schluckte der Designer ⌘Z und ⌘D des Browsers
  * @param hasBlock ein Baustein ist gewählt (Entf, ⌘D, ⌥↑↓ wirken auf ihn) - Entf löscht ihn, wo der Fokus
  *   nicht in einem Feld ist (auch auf einem Knopf der Gliederung: dort ist er gewählt)
  * @param can ob es etwas rückgängig zu machen / zu wiederholen gibt - sonst bleibt ⌘Z dem Browser */
export function designerKey(
  e: KeyLike, inField: boolean, canEdit: boolean, hasBlock: boolean, can = { undo: true, redo: true },
): { action: DesignerKey; run: boolean } | null {
  if (e.defaultPrevented || inField) return null;
  if (e.key === 'Escape') return { action: 'deselect', run: true };
  if (!canEdit) return null;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  // ⌘Z wiederholt sich gedrückt gehalten (die Schritte lesen den neuesten Stand)
  const undoRedo = (action: 'undo' | 'redo') => (can[action] ? { action, run: true } : null);
  if (mod && k === 'z') return undoRedo(e.shiftKey ? 'redo' : 'undo');
  if (mod && k === 'y') return undoRedo('redo');
  if (!hasBlock) return null;
  // nur Entf - Backspace auf einem Knopf oder der Seite löschte sonst ungewollt
  const action: DesignerKey | null = e.key === 'Delete' ? 'remove'
    : mod && k === 'd' ? 'duplicate'
    : e.altKey && e.key === 'ArrowUp' ? 'up'
    : e.altKey && e.key === 'ArrowDown' ? 'down'
    : null;
  // gedrückt gehalten: ein Schritt je Druck - die Aktionen kennen den Baustein des letzten Renderns, nach
  // einem Verschieben ist er woanders; die Taste bleibt trotzdem dem Designer (run: false)
  return action && { action, run: !e.repeat };
}
