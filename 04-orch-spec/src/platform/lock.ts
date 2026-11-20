// The spec is locked while a run of the studio is running or waiting (E25): everything that may edit asks
// here too (usePermissions in auth.tsx). One switch per page, set by the status of the run.
import { useSyncExternalStore } from 'react';

const state = { locked: false };
const listeners = new Set<() => void>();

export function setSpecLocked(locked: boolean): void {
  if (state.locked === locked) return;
  state.locked = locked;
  listeners.forEach(l => l());
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
};

/** Is the spec locked by a run? */
export const useSpecLocked = (): boolean => useSyncExternalStore(subscribe, () => state.locked, () => false);
