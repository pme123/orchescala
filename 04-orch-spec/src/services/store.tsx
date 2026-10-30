// The services in the shared folder — `services/<slug>.json`, one file per
// collection (and later per orchestration). The same mechanics as the processes
// and pages: conflict detection via version/ETag, autosave in the caller, never
// overwrite blindly (a new file is created only with `createOnly`).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useStore, type SaveResult } from '../store';
import type { StorageBackend } from '../backend';
import type { ServiceSpec } from './types';
import { withServiceApis } from './collection';

export const SERVICES_DIR = 'services';

export interface ServiceListItem {
  slug: string;
  data: ServiceSpec;
  version: string;
}

interface ServicesCtx {
  services: ServiceListItem[];
  /** until the list has been read for the first time */
  servicesLoading: boolean;
  /** files in services/ that are not readable — with the reason */
  servicesUnreadable: { file: string; problem: string }[];
  refreshServices: () => Promise<void>;
  loadService: (slug: string) => Promise<{ data: ServiceSpec; version: string } | null>;
  saveService: (data: ServiceSpec, expectedVersion: string) => Promise<SaveResult>;
  createService: (data: ServiceSpec) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteService: (slug: string, expectedVersion: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}

const Ctx = createContext<ServicesCtx>(null!);
export const useServices = () => useContext(Ctx);

const byTitle = (a: ServiceListItem, b: ServiceListItem) => (a.data.title || a.slug).localeCompare(b.data.title || b.slug, 'de');
const pathOf = (slug: string) => `${SERVICES_DIR}/${slug}.json`;

/** The shape the views rely on — what does not fit counts as unreadable. */
export function serviceProblem(raw: unknown): string | null {
  const r = raw as Partial<ServiceSpec> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'kein JSON-Objekt';
  if (r.kind !== 'serviceCollection') return `unbekannte Art «${String(r.kind)}»`;
  if (!Array.isArray(r.services)) return '«services» fehlt';
  if (!Array.isArray(r.types)) return '«types» fehlt';
  return null;
}

export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const { storage, getBackend } = useStore();
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesUnreadable, setUnreadable] = useState<{ file: string; problem: string }[]>([]);
  // a newer read wins over an older one; a read of the previous folder changes nothing
  const seq = useRef(0);

  const refreshIn = useCallback(async (be: StorageBackend) => {
    const mine = ++seq.current;
    const items: ServiceListItem[] = [];
    const unreadable: { file: string; problem: string }[] = [];
    try {
      const files = (await be.list(SERVICES_DIR)).filter(f => f.name.endsWith('.json'));
      // read concurrently — with SharePoint every file is a call of its own
      await Promise.all(files.map(async f => {
        const read = await be.read(`${SERVICES_DIR}/${f.name}`);
        if (!read) return;
        try {
          const data: unknown = JSON.parse(read.text);
          const problem = serviceProblem(data);
          if (problem) throw new Error(problem);
          items.push({ slug: f.name.replace(/\.json$/, ''), data: withServiceApis(data as ServiceSpec), version: read.version });
        } catch (e) {
          unreadable.push({ file: f.name, problem: e instanceof Error ? e.message : String(e) });
        }
      }));
    } catch (e) {
      // no folder services/ yet is the normal case — the list stays empty
      console.info('[orch-spec] services/:', e);
    }
    if (seq.current !== mine || getBackend() !== be) return;
    setServices(items.sort(byTitle));
    setUnreadable(unreadable.sort((a, b) => a.file.localeCompare(b.file)));
    setServicesLoading(false);
  }, [getBackend]);

  // another folder: nothing from the previous one, then read
  useEffect(() => {
    seq.current++;
    setServices([]); setUnreadable([]); setServicesLoading(true);
    const be = getBackend();
    if (be && storage) void refreshIn(be);
  }, [storage, getBackend, refreshIn]);

  const refreshServices = useCallback(async () => {
    const be = getBackend();
    if (be) await refreshIn(be);
  }, [getBackend, refreshIn]);

  const loadService = useCallback(async (slug: string) => {
    const be = getBackend();
    if (!be) return null;
    const read = await be.read(pathOf(slug));
    if (!read) return null;
    const data: unknown = JSON.parse(read.text);
    const problem = serviceProblem(data);
    if (problem) throw new Error(`${pathOf(slug)}: ${problem}`);
    return { data: withServiceApis(data as ServiceSpec), version: read.version };
  }, [getBackend]);

  const write = useCallback(async (data: ServiceSpec, opts: { ifMatch?: string; createOnly?: boolean }): Promise<SaveResult & { exists?: true }> => {
    const be = getBackend();
    if (!be) return { status: 'error', message: 'Kein Ordner gewählt.' };
    try { await be.ensureDir(SERVICES_DIR); } catch { /* write reports it */ }
    const w = await be.write(pathOf(data.slug), JSON.stringify(data, null, 2) + '\n', opts);
    if (!w.ok) {
      if (w.reason === 'conflict') return { status: 'conflict', currentVersion: w.currentVersion ?? '' };
      if (w.reason === 'exists') return { status: 'error', message: 'Die Datei gibt es schon.', exists: true };
      return { status: 'error', message: w.reason === 'forbidden' ? w.message : 'Schreiben fehlgeschlagen — die Datei wurde NICHT gespeichert.' };
    }
    if (getBackend() === be)
      setServices(prev => [...prev.filter(s => s.slug !== data.slug), { slug: data.slug, data, version: w.version }].sort(byTitle));
    return { status: 'saved', version: w.version };
  }, [getBackend]);

  const saveService = useCallback((data: ServiceSpec, expectedVersion: string) =>
    write(data, { ifMatch: expectedVersion }), [write]);

  const createService = useCallback(async (data: ServiceSpec) => {
    const r = await write(data, { createOnly: true });
    if (r.status === 'saved') return { ok: true as const };
    return { ok: false as const, message: r.exists ? `«${data.slug}» gibt es schon.` : r.status === 'error' ? r.message : 'Konflikt beim Anlegen.' };
  }, [write]);

  const deleteService = useCallback(async (slug: string, expectedVersion: string) => {
    const be = getBackend();
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const d = await be.delete(pathOf(slug), { ifMatch: expectedVersion });
    if (!d.ok) return { ok: false as const, message: d.reason === 'conflict' ? 'Inzwischen geändert – Seite neu laden.' : d.message };
    if (getBackend() === be) setServices(prev => prev.filter(s => s.slug !== slug));
    return { ok: true as const };
  }, [getBackend]);

  return (
    <Ctx.Provider value={{ services, servicesLoading, servicesUnreadable, refreshServices, loadService, saveService, createService, deleteService }}>
      {children}
    </Ctx.Provider>
  );
}
