// The runs of the studio in React: the config asked once per page (`GET /platform/config`, config.ts) -
// off until it answered, and when there is none; and the status of the project of the open folder,
// asked again every few seconds. A run that is open locks the spec (lock.ts).
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { callPlatform, loadPlatformConfig, NO_STATUS, PLATFORM_OFF, platformPath, runOpen, type PlatformConfig, type ProjectStatus } from './config';
import { setSpecLocked } from './lock';

// once per page
const state = { config: PLATFORM_OFF, started: false };
const listeners = new Set<() => void>();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  if (!state.started && typeof window !== 'undefined') {
    state.started = true;
    void loadPlatformConfig().then(c => {
      state.config = c;
      listeners.forEach(l => l());
    });
  }
  return () => { listeners.delete(onChange); };
};

/** The runs of the studio - off until it answered, and when there is none. */
export function usePlatformConfig(): PlatformConfig {
  return useSyncExternalStore(subscribe, () => state.config, () => PLATFORM_OFF);
}

/** How often the status is asked: while a run is open, and otherwise (another RE may have started one).
  * `?runpoll=<ms>` for tests. */
const OPEN_MS = 5000;
const IDLE_MS = 30000;
const pollMs = (open: boolean) => {
  const fixed = typeof location === 'undefined' ? NaN : Number(new URLSearchParams(location.search).get('runpoll'));
  return fixed > 0 ? fixed : open ? OPEN_MS : IDLE_MS;
};

/** The last run and the open work of `project` - none without a project. */
export function useProjectStatus(project: string | undefined) {
  const [value, setValue] = useState<ProjectStatus>(NO_STATUS);
  const refresh = useCallback(async () => {
    if (!project) return;
    const r = await callPlatform<ProjectStatus>(platformPath(project, 'status'));
    if ('ok' in r) setValue(r.ok);
  }, [project]);
  const open = runOpen(value.status);
  useEffect(() => {
    if (!project) {
      setValue(NO_STATUS);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs(open));
    return () => clearInterval(timer);
  }, [project, open, refresh]);
  useEffect(() => {
    setSpecLocked(!!project && open);
    return () => setSpecLocked(false);
  }, [project, open]);
  return { value, setValue, refresh };
}
