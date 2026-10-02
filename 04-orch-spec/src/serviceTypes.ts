// Service-Objekte als Feldtypen.
//
// Ein Katalog-Eintrag (element-template) trägt seine Orchescala-Herkunft im
// Namen. Daraus lassen sich Objekt und Package ableiten:
//
//   globex-crm-accountV1.GetAccount
//     → object  GetAccount
//     → package globex.crm.domain.account.v1
//     → Typen   GetAccount.In · GetAccount.Out
//
//   globex-product-openAccountV2            (Teilprozess)
//     → object  OpenAccount   (die Version steht im Package, nicht im Namen)
//     → package globex.product.domain.openAccount.v2
//
// Im Datenmodell steht ein solcher Feldtyp als `svc:<serviceId>:<In|Out>`.
// Kennt der Domain-Katalog das Objekt — einen Prozess über `processName`,
// ein Service-Objekt über seinen Namen —, gilt der Katalog (`catalogObject`).
// Sonst ist die Ableitung eine gute Vermutung, kein Beweis — bei ungewöhnlich
// aufgebauten Namen markiert `uncertain`, dass der Import zu prüfen ist.

import type { DomainType, Model, ServiceDef } from './types';
import { ORCHESCALA_TYPES } from './orchescalaTypes';

export type ServiceMember = 'In' | 'Out';

export interface ServiceType {
  /** Feldwert im Datenmodell */
  value: string;
  serviceId: string;
  member: ServiceMember;
  /** Scala-Typ, z. B. `GetAccount.Out` */
  name: string;
  /** Package des Objekts, z. B. `globex.crm.domain.account.v1` */
  pkg: string;
  /** vollständige import-Zeile */
  importPath: string;
  /** Anzeigename des Services */
  label: string;
  group: string;
  /** Ableitung unsicher — Import im Projekt prüfen */
  uncertain?: boolean;
}

export const SERVICE_PREFIX = 'svc:';

const capitalize = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

/** `svc:<serviceId>:<member>` zerlegen; null = kein Service-Typ. */
export function parseServiceRef(ref: string): { serviceId: string; member: ServiceMember } | null {
  if (!ref.startsWith(SERVICE_PREFIX)) return null;
  const rest = ref.slice(SERVICE_PREFIX.length);
  const at = rest.lastIndexOf(':');
  if (at < 0) return null;
  const member = rest.slice(at + 1);
  if (member !== 'In' && member !== 'Out') return null;
  return { serviceId: rest.slice(0, at), member };
}

export const serviceRef = (serviceId: string, member: ServiceMember) =>
  `${SERVICE_PREFIX}${serviceId}:${member}`;

interface Derived { object: string; pkg: string; uncertain: boolean }

/** Objekt und Package aus der Template-ID ableiten. */
export function deriveObject(serviceId: string): Derived {
  const dotted = serviceId.split('.');
  const prefix = dotted[0];
  const last = dotted[dotted.length - 1];

  const segments = prefix.split('-').filter(Boolean);
  const tail = segments[segments.length - 1] ?? prefix;
  const m = /^(.*?)V(\d+)$/.exec(tail);
  const name = m ? m[1] : tail;
  const version = m ? `v${m[2]}` : 'v1';

  // Üblich ist <firma>-<projekt>-<api><Version>. Fehlt die Versionsendung oder
  // die Projektebene, ist die Zerlegung nicht mehr eindeutig — dann ist der
  // Import eine Vermutung (z. B. `globex-documents-print-document`).
  const uncertain = segments.length < 3 || !m;
  const head = uncertain ? segments : segments.slice(0, -1);
  const pkg = [...head, 'domain', name, version].join('.');

  // Steht hinter dem letzten Punkt ein Objektname (Grossbuchstabe), gilt der;
  // sonst ist der Eintrag ein Prozess und heisst wie sein letztes Segment —
  // ohne die Version, die steht im Package (`loadPoasV1` → `LoadPoas`)
  const object = dotted.length > 1 && /^[A-Z]/.test(last) ? last : capitalize(name);
  return { object, pkg, uncertain };
}

/**
 * Objekt und Package aus dem Domain-Katalog: ein Prozess über seine
 * `processName` (`valiant-vollmacht-loadPoasV1` → `LoadPoas` in
 * `valiant.vollmacht.domain.loadPoas.v1`), ein Service-Objekt über seinen
 * Namen (`valiant-services-tadv2.GetProfileCompletionCustomerId` → in
 * `valiant.services.domain.tad.v2`) — gibt es den Namen mehrfach, das im
 * abgeleiteten Package, sonst keines. Null, wenn der Katalog es nicht kennt.
 */
export function catalogObject(ref: string, model: Model | null): Derived | null {
  const all = model?.domainTypes ?? [];
  const asObject = (t: DomainType): Derived => ({ object: t.owner!, pkg: t.pkg, uncertain: false });
  const process = all.find(t => t.owner && t.processName === ref);
  if (process) return asObject(process);
  const derived = deriveObject(ref);
  if (!ref.includes('.') || !/^[A-Z]/.test(derived.object)) return null;
  const owners = all.filter(t => t.owner === derived.object);
  const pkgs = [...new Set(owners.map(t => t.pkg))];
  if (pkgs.length === 1) return asObject(owners[0]);
  const same = owners.find(t => t.pkg === derived.pkg);
  return same ? asObject(same) : null;
}

/** Objekt und Package — aus dem Katalog, sonst abgeleitet. */
export const objectOf = (ref: string, model: Model | null): Derived =>
  catalogObject(ref, model) ?? deriveObject(ref);

function typeOf(svc: ServiceDef, member: ServiceMember, model: Model | null): ServiceType {
  const { object, pkg, uncertain } = objectOf(svc.id, model);
  return {
    value: serviceRef(svc.id, member),
    serviceId: svc.id,
    member,
    name: `${object}.${member}`,
    pkg,
    importPath: `${pkg}.${object}`,
    label: svc.name || svc.id,
    group: svc.group ?? '—',
    ...(uncertain ? { uncertain: true } : {}),
  };
}

/** Alle wählbaren Service-Objekte des Katalogs. */
export function serviceTypes(model: Model | null): ServiceType[] {
  const out: ServiceType[] = [];
  for (const svc of model?.services ?? []) {
    out.push(typeOf(svc, 'In', model), typeOf(svc, 'Out', model));
  }
  return out;
}

/** Ein einzelner Service-Typ — auch wenn der Katalog ihn (noch) nicht kennt. */
export function serviceTypeOf(ref: string, model: Model | null): ServiceType | null {
  const parsed = parseServiceRef(ref);
  if (!parsed) return null;
  const svc = model?.services.find(s => s.id === parsed.serviceId)
    ?? { id: parsed.serviceId, name: parsed.serviceId } as ServiceDef;
  return typeOf(svc, parsed.member, model);
}

// ── Typen aus dem Domain-Katalog ─────────────────────────────────────────────
// Diese sind aus den Quellen eingelesen, also exakt — im Gegensatz zu den oben
// aus dem Servicenamen abgeleiteten. Im Datenmodell steht ein solcher Feldtyp
// als `dom:<voll qualifizierter Name>`.

export const DOMAIN_PREFIX = 'dom:';

export const domainRef = (id: string) => `${DOMAIN_PREFIX}${id}`;

export function parseDomainRef(ref: string): string | null {
  return ref.startsWith(DOMAIN_PREFIX) ? ref.slice(DOMAIN_PREFIX.length) : null;
}

/**
 * Der Katalog-Typ zu einem Feldtyp. Ein Verweis (`domain:<id>`) wird über
 * die Id gefunden. Ein blosser Name (`ProcessCallOrigin`) bleibt vom Import
 * zurück, wenn der Katalog den Typ damals nicht kannte — kennt er ihn
 * jetzt, zählt das: der Name löst sich auf, sobald er eindeutig ist.
 */
export function domainTypeOf(ref: string, model: Model | null): DomainType | null {
  const all = model?.domainTypes ?? [];
  const id = parseDomainRef(ref);
  // die Typen aus `orchescala.domain` gibt es auch ohne geladenen Katalog
  if (id) return all.find(t => t.id === id) ?? ORCHESCALA_TYPES.find(t => t.id === id) ?? null;
  if (!/^[A-Z][\w.]*$/.test(ref)) return null;
  const byName = all.filter(t => t.name === ref);
  return byName.length === 1 ? byName[0] : null;
}

/** Fällt der Katalog weg, bleibt wenigstens der Name lesbar. */
export function domainNameOf(ref: string): string {
  const id = parseDomainRef(ref) ?? '';
  const parts = id.split('.');
  // `pkg.Owner.In` → `Owner.In`, `pkg.schema.InAddress` → `InAddress`
  const upper = parts.findIndex(p => /^[A-Z]/.test(p));
  return upper < 0 ? id : parts.slice(upper).join('.');
}
