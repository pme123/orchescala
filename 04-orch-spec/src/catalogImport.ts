// Replace the catalog — and say beforehand what gets lost in the process.
//
// In the banking zone the sources are not available; there the catalog comes in as a
// file and **replaces** the existing one. A replacement can remove entries
// that specifications point to: a service that a step
// calls, or a domain type that a field uses. Both would otherwise remain as a
// red reference, and nobody would know when it came about.
//
// That is why a comparison is made before replacing — and the user is only asked if something
// is really missing.

import { allSteps } from './bpmn.ts';
import { parseDomainRef } from './serviceTypes.ts';
import type { DomainDefault, DomainType, ProcessSpec, ServiceDef } from './types.ts';

export interface Referenced {
  /** Service IDs, topics and called processes from all steps */
  services: Set<string>;
  /** IDs of the domain types used in fields */
  types: Set<string>;
}

/** What the specifications point to. */
export function referenced(specs: ProcessSpec[]): Referenced {
  const services = new Set<string>();
  const types = new Set<string>();
  for (const spec of specs) {
    for (const step of allSteps(spec.steps)) {
      for (const v of [step.serviceId, step.topic, step.calledProcess]) if (v) services.add(v);
    }
    for (const t of spec.types ?? []) {
      for (const f of t.fields ?? []) {
        const id = parseDomainRef(f.type);
        if (id) types.add(id);
      }
    }
  }
  return { services, types };
}

export interface Losses {
  services: ServiceDef[];
  types: DomainType[];
}

/**
 * What the new catalog no longer provides, although a specification
 * uses it. A service counts as present if its ID, its topic
 * or its called process matches it — the process view searches for it the same way.
 */
export function losses(
  current: { services?: ServiceDef[]; domainTypes?: DomainType[] },
  incoming: { services?: ServiceDef[]; domainTypes?: DomainType[] },
  refs: Referenced,
): Losses {
  const kennt = new Set<string>();
  for (const s of incoming.services ?? []) {
    kennt.add(s.id);
    if (s.topic) kennt.add(s.topic);
    if (s.calledProcess) kennt.add(s.calledProcess);
  }
  const typIds = new Set((incoming.domainTypes ?? []).map(t => t.id));

  const verwendet = (s: ServiceDef) =>
    refs.services.has(s.id)
    || (!!s.topic && refs.services.has(s.topic))
    || (!!s.calledProcess && refs.services.has(s.calledProcess));

  return {
    services: (current.services ?? []).filter(s => verwendet(s) && !kennt.has(s.id)
      && !(s.topic && kennt.has(s.topic)) && !(s.calledProcess && kennt.has(s.calledProcess))),
    types: (current.domainTypes ?? []).filter(t => refs.types.has(t.id) && !typIds.has(t.id)),
  };
}

export interface CatalogFile {
  company?: string;
  services?: ServiceDef[];
  domainTypes?: DomainType[];
  domainDefaults?: DomainDefault[];
  domainSources?: string[];
  /** the scanned projects — `scannedAt`: when (ISO), see `ProjectFolder.scannedAt` */
  projects?: Array<{ id: string; name: string; types?: number; scannedAt?: string }>;
  /** Project name → colour (`ProjectConfig.color`) — written by `prepareDocs` from the Orchescala configuration */
  projectColors?: Record<string, string>;
}

/** What a catalog file that was read contains — or why it is not usable. */
export function readCatalogFile(text: string): { ok: true; data: CatalogFile } | { ok: false; message: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { ok: false, message: 'Die Datei ist kein gültiges JSON.' }; }
  const d = (raw ?? {}) as CatalogFile;
  // only project colours: `prepareDocs` writes that even without Node.js
  const colors = d.projectColors && typeof d.projectColors === 'object' && Object.keys(d.projectColors).length > 0;
  const projectColors = colors ? withoutNoColor(d.projectColors!) : undefined;
  if (!Array.isArray(d.services) && !Array.isArray(d.domainTypes) && !colors) {
    return { ok: false, message: 'Darin steht kein Katalog (weder services noch domainTypes).' };
  }
  return {
    ok: true,
    data: {
      ...d,
      ...(Array.isArray(d.services) ? { services: withoutGenerated(d.services) } : {}),
      ...(Array.isArray(d.domainTypes) ? { domainTypes: withoutGenerated(d.domainTypes) } : {}),
      ...(colors ? { projectColors } : {}),
    },
  };
}

/** What means «keine Farbe» in Orchescala (`ProjectConfig.color` is `#fff`, the docs use `white`) */
const NO_COLOR = new Set(['', '#fff', '#ffffff', 'white']);

/** Project colours without those that are none — otherwise «weiss» would show as the chosen colour */
export function withoutNoColor(colors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(colors).filter(([, c]) => typeof c === 'string' && !NO_COLOR.has(c.trim().toLowerCase())));
}

/**
 * Without the `generated` marker. It only says that an entry comes from the
 * `catalog.generated.json` just shipped — it has no business being
 * in a file: an export with the marker would come in on import as «mitgeliefert»
 * and would be filtered out of the model.json on save.
 */
export function withoutGenerated<T extends { generated?: boolean }>(entries: T[]): T[] {
  return entries.map(e => {
    if (!('generated' in e)) return e;
    const { generated: _, ...rest } = e;
    return rest as T;
  });
}
