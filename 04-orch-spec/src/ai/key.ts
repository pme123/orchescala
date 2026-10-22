// The AI mode (E19, E20): the personal API key of the Claude API is the switch. With a key the AI
// mode is on, without one nothing of AI is visible - only the field for the key in the settings.
//
// **Storage**: in this browser only (`localStorage`, `orch-spec.anthropicKey`) - never in the spec
// folder, never in SharePoint. Two people on the same folder: only the one with a key sees the AI.
// Deleting the key turns the AI off at once - in every component and every tab of this browser.
import { useSyncExternalStore } from 'react';

export const KEY_STORAGE = 'orch-spec.anthropicKey';
/** the event within this tab - `storage` only fires in the other tabs */
const CHANGED = 'orch-spec:anthropic-key';

/** What the key functions need of `localStorage` - in the tests a Map. */
export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStore = (): KeyStore | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

/** The key - null if there is none (or the storage is blocked). */
export function readKey(store: KeyStore | null = browserStore()): string | null {
  try { return store?.getItem(KEY_STORAGE)?.trim() || null; } catch { return null; }
}

/** Saves the key - an empty one deletes it (= AI off). */
export function writeKey(key: string, store: KeyStore | null = browserStore()): void {
  const value = key.trim();
  try {
    if (value) store?.setItem(KEY_STORAGE, value);
    else store?.removeItem(KEY_STORAGE);
  } catch { /* blocked storage: then there is no AI */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

/** The switch: with a key the AI mode is on. */
export const aiEnabled = (key: string | null | undefined): key is string => !!key?.trim();

/** A key of the Claude API starts with `sk-ant-` - only a hint, the API decides. */
export const looksLikeKey = (key: string) => /^sk-ant-[\w-]{20,}$/.test(key.trim());

/** Shows a key without giving it away: `sk-ant-…a1b2`. */
export const maskKey = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;

const subscribe = (onChange: () => void) => {
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === KEY_STORAGE) onChange(); };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onStorage);
  };
};

/** The key of this browser - every component that shows something of AI asks this. */
export function useAiKey(): string | null {
  return useSyncExternalStore(subscribe, () => readKey(), () => null);
}
