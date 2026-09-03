// Katalog ersetzen — und vorher sagen, was dabei verloren geht.
//
// In der Bankenzone liegen die Quellen nicht; dort kommt der Katalog als
// Datei herein und **ersetzt** den bestehenden. Ein Ersetzen kann Einträge
// wegnehmen, auf die Spezifikationen zeigen: ein Service, den ein Schritt
// ruft, oder ein Domain-Typ, den ein Feld verwendet. Beides bliebe sonst als
// roter Verweis zurück, und niemand wüsste, wann er entstanden ist.
//
// Deshalb wird vor dem Ersetzen verglichen — und nur gefragt, wenn wirklich
// etwas fehlt.

import { allSteps } from './bpmn.ts';
import { parseDomainRef } from './serviceTypes.ts';
import type { DomainType, ProcessSpec, ServiceDef } from './types.ts';

export interface Referenced {
  /** Service-IDs, Topics und gerufene Prozesse aus allen Schritten */
  services: Set<string>;
  /** IDs der Domain-Typen, die in Feldern stehen */
  types: Set<string>;
}

/** Worauf die Spezifikationen zeigen. */
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
 * Was der neue Katalog nicht mehr hergibt, obwohl eine Spezifikation es
 * verwendet. Ein Service gilt als vorhanden, wenn ihn seine ID, sein Topic
 * oder sein gerufener Prozess trifft — genauso sucht ihn die Prozessansicht.
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
  domainSources?: string[];
  projects?: Array<{ id: string; name: string; types?: number }>;
}

/** Was in einer eingelesenen Katalog-Datei steht — oder warum sie nicht taugt. */
export function readCatalogFile(text: string): { ok: true; data: CatalogFile } | { ok: false; message: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { ok: false, message: 'Die Datei ist kein gültiges JSON.' }; }
  const d = (raw ?? {}) as CatalogFile;
  if (!Array.isArray(d.services) && !Array.isArray(d.domainTypes)) {
    return { ok: false, message: 'Darin steht kein Katalog (weder services noch domainTypes).' };
  }
  return { ok: true, data: d };
}
