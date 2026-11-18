// The AI of the studio in React - asked once per page (`GET /ai/config`, see config.ts); off until
// it answered, and when there is none. Browser only: it removes the key of the time before E23 from
// localStorage.
import { useSyncExternalStore } from 'react';
import { AI_OFF, aiFor, loadConfig, type AiConfig, type AiTask } from './config';

// once per page: every component that shows something of AI asks the same answer
let current: AiConfig = AI_OFF;
let started = false;
const listeners = new Set<() => void>();

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  forgetBrowserKey();
  void loadConfig().then((c) => {
    current = c;
    listeners.forEach((l) => l());
  });
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  start();
  return () => { listeners.delete(onChange); };
};

/** The AI of the studio - off until it answered, and when there is none. */
export function useAiConfig(): AiConfig {
  return useSyncExternalStore(subscribe, () => current, () => AI_OFF);
}

/** The switch of one place: the AI of its task. */
export const useAiFor = (task: AiTask): boolean => aiFor(useAiConfig(), task);

/** Until E23 the key was stored in the browser - it is removed, so it does not stay there unused. */
export const OLD_BROWSER_KEYS = ['orch-spec.anthropicKey', 'orch-spec.anthropicWorkspace'];

export function forgetBrowserKey(store: Pick<Storage, 'removeItem'> | null = browserStore()): void {
  try { OLD_BROWSER_KEYS.forEach((k) => store?.removeItem(k)); } catch { /* blocked storage */ }
}

function browserStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
