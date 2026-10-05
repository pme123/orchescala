// Kopieren und Einfügen: was mit den Elementen in eine andere Spezifikation
// (oder dieselbe) wandert — ohne Oberfläche, damit es sich prüfen lässt.
//
// Regeln:
//  · Alles Eingefügte ist **Entwurf** — im Ziel ist es noch nicht umgesetzt.
//  · Klassen kommen **immer als Kopie**, auch die, auf die verwiesen wird; bei
//    gleichem Namen mit Zähler (`Address2`). Neue IDs für Klassen, Felder und
//    Interaktionen — Kommentare der Quelle kommen nicht mit.
//  · Verweise in den Katalog (`dom:…`, `svc:…`) und einfache Typen bleiben.
//  · Im Diagramm vergibt bpmn-js die IDs; `overlayPasted` hängt danach die
//    Angaben der Quelle an die neuen Schritte (siehe clipboard.ts).
import type { Field, Interaction, ProcessSpec, Step, TypeDef } from './types.ts';
import { allSteps } from './bpmn.ts';
import { uid } from './util.ts';
import type { ClipSource, DiagramSpec, PastedElements } from './clipboard.ts';

// ── Datenmodell ──────────────────────────────────────────────────────────────

/** Alle Felder einer Klasse — bei einer Auswahl auch die der Fälle */
const fieldsOf = (t: TypeDef): Field[] => [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])];

/**
 * Die eigenen Klassen ab `rootIds` samt allen eigenen Klassen, auf die ihre
 * Felder (auch in den Fällen einer Auswahl) verweisen — in Reihenfolge des
 * Fundes, die Wurzeln zuerst.
 */
export function typeClosure(types: TypeDef[] | undefined, rootIds: string[]): TypeDef[] {
  const byId = new Map((types ?? []).map(t => [t.id, t]));
  const seen = new Set<string>();
  const out: TypeDef[] = [];
  const visit = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    const t = byId.get(id);
    if (!t) return;
    seen.add(id);
    out.push(t);
    for (const f of fieldsOf(t)) visit(f.type);
  };
  rootIds.forEach(visit);
  return out;
}

/** `Address` → `Address2`, `Address2` → `Address3` — bis der Name frei ist */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const m = /^(.*\D)(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}

/** Ein Feld mit neuer ID; der Typ zeigt auf die Kopie, wo es eine gibt. */
const copyField = (f: Field, idMap: Map<string, string>): Field => ({
  ...f,
  id: uid('f'),
  type: idMap.get(f.type) ?? f.type,
});

/**
 * Klassen als Kopien für das Ziel `target`: neue IDs, eindeutige Namen,
 * Entwurf, ohne die Rollen der Quelle (Prozess-In/Out, InitIn, InConfig …).
 * `interactions`: Klassen dieser Interaktionen bleiben deren In/Out — unter
 * dem neuen Namen der Interaktion (`<Name>.In`).
 */
export function pasteTypes(
  target: TypeDef[] | undefined,
  types: TypeDef[],
  interactions: Map<string, { id: string; name: string }> = new Map(),
): { types: TypeDef[]; idMap: Map<string, string> } {
  const idMap = new Map(types.map(t => [t.id, uid(t.kind === 'enum' ? 'e' : 't')]));
  const taken = new Set((target ?? []).map(t => t.name));
  const out = types.map(t => {
    const {
      root: _root, processOut: _out, initIn: _initIn, inConfig: _inConfig, interactionId,
      inProcessObject: _inObject, domainId: _domainId, ...rest
    } = t;
    const ia = interactionId ? interactions.get(interactionId) : undefined;
    const member = t.name.split('.').pop() ?? t.name;
    const name = ia ? `${ia.name}.${member}` : uniqueName(t.name.replace(/\./g, ''), taken);
    taken.add(name);
    const copy: TypeDef = {
      ...rest,
      id: idMap.get(t.id)!,
      name,
      status: 'draft',
      ...(ia ? { interactionId: ia.id } : {}),
    };
    if (t.fields) copy.fields = t.fields.map(f => copyField(f, idMap));
    if (t.values) copy.values = t.values.map(v => (v.fields ? { ...v, fields: v.fields.map(f => copyField(f, idMap)) } : { ...v }));
    return copy;
  });
  return { types: out, idMap };
}

/** Eine kopierte Klasse einfügen — gibt die neuen Klassen und die ID der eingefügten zurück. */
export function pasteType(spec: ProcessSpec, clip: { typeId: string; types: TypeDef[] }): { types: TypeDef[]; id: string } {
  const { types, idMap } = pasteTypes(spec.types, clip.types);
  return { types: [...(spec.types ?? []), ...types], id: idMap.get(clip.typeId)! };
}

/**
 * Ein kopiertes Feld an die Klasse `typeId` hängen — bei einer Auswahl an den
 * Fall Nummer `valueIndex`, ohne an die gemeinsamen Felder. Der Name wird in der
 * Klasse eindeutig (`street2`); Klassen, auf die das Feld verweist, kommen als
 * Kopie mit. `null`, wenn es die Klasse nicht gibt.
 */
export function pasteField(
  spec: ProcessSpec,
  typeId: string,
  clip: { field: Field; types: TypeDef[] },
  valueIndex?: number,
): { types: TypeDef[]; fieldId: string } | null {
  const t = (spec.types ?? []).find(x => x.id === typeId);
  if (!t) return null;
  const value = valueIndex !== undefined ? t.values?.[valueIndex] : undefined;
  if (valueIndex !== undefined && !value) return null;
  const { types: added, idMap } = pasteTypes(spec.types, clip.types);
  // Fall einer Auswahl: auch die gemeinsamen Felder zählen — sonst gäbe es den Namen doppelt
  const siblings = value ? [...(t.fields ?? []), ...(value.fields ?? [])] : (t.fields ?? []);
  const field = { ...copyField(clip.field, idMap), name: uniqueName(clip.field.name, new Set(siblings.map(f => f.name))) };
  const next: TypeDef = value
    ? { ...t, values: t.values!.map(v => (v === value ? { ...v, fields: [...(v.fields ?? []), field] } : v)) }
    : { ...t, fields: [...(t.fields ?? []), field] };
  return { types: [...(spec.types ?? []).map(x => (x.id === typeId ? next : x)), ...added], fieldId: field.id };
}

// ── Diagramm ─────────────────────────────────────────────────────────────────

/** Ein Schritt ohne seine verschachtelten Schritte — die kommen als eigene Einträge */
const flat = (s: Step): Step => {
  const { children: _children, ...rest } = s;
  return {
    ...rest,
    ...(s.branches ? { branches: s.branches.map(b => ({ ...b, steps: [] })) } : {}),
    ...(s.errors ? { errors: s.errors.map(({ steps: _steps, ...e }) => e) } : {}),
  };
};

/** Der Spezifikationsanteil der im Modeler kopierten Elemente `ids` */
export function collectDiagram(spec: ProcessSpec, ids: string[], source: ClipSource): DiagramSpec {
  const wanted = new Set(ids);
  const steps = Object.fromEntries(allSteps(spec.steps).filter(s => wanted.has(s.id)).map(s => [s.id, flat(s)]));
  const interactions = (spec.interactions ?? []).filter(i => wanted.has(i.stepId));
  const roots = interactions.flatMap(i => [i.inTypeId, i.outTypeId]).filter((x): x is string => !!x);
  return { source, steps, interactions, types: typeClosure(spec.types, roots) };
}

/**
 * Was die Spezifikation festlegt und nicht (verlässlich) im BPMN steht: es
 * gilt, wie es in der Quelle war — auch leer.
 */
const SPEC_KEYS = ['description', 'serviceId', 'topic', 'calledProcess', 'inputs', 'outputs',
  'inVariant', 'outVariant', 'mock', 'mockKind'] as const;
/** Was auch im BPMN steht: aus der Quelle, wo sie es hat — sonst wie im Diagramm. */
const BPMN_KEYS = ['candidateGroups', 'candidateUsers', 'assignee', 'regexHandledErrors',
  'resultVariable', 'outputVariables', 'manualOutMapping', 'decisionResult'] as const;

function mapSteps(steps: Step[], f: (s: Step) => Step): Step[] {
  return steps.map(s0 => {
    const s = f(s0);
    return {
      ...s,
      ...(s.children ? { children: mapSteps(s.children, f) } : {}),
      ...(s.branches ? { branches: s.branches.map(b => ({ ...b, steps: mapSteps(b.steps, f) })) } : {}),
      ...(s.errors ? { errors: s.errors.map(e => (e.steps ? { ...e, steps: mapSteps(e.steps, f) } : e)) } : {}),
    };
  });
}

/** Die Angaben des Quellschritts `src` auf den eingefügten Schritt `s` legen. */
function overlayStep(s: Step, src: Step, oldIdOf: Map<string, string>): Step {
  const next: Step = { ...s, status: 'draft' };
  for (const k of SPEC_KEYS) {
    if (src[k] === undefined) delete next[k];
    else next[k] = src[k] as never;
  }
  for (const k of BPMN_KEYS) if (src[k] !== undefined) next[k] = src[k] as never;
  // Zweige: Bezeichnung und Bedingung über den Fluss, aus dem der neue kopiert ist
  if (s.branches && src.branches) {
    next.branches = s.branches.map(b => {
      const o = src.branches!.find(x => x.id === oldIdOf.get(b.id));
      return o ? { ...b, label: o.label || b.label, ...(o.condition !== undefined ? { condition: o.condition } : {}) } : b;
    });
  }
  // Fehler: Bezeichnungen nach Code; behandelte Fehler ohne Boundary-Event
  // stehen sonst nur in `_handledErrors` — beim Wechsel der Engine fehlt das
  if (src.errors?.length) {
    const own = (s.errors ?? []).map(e => {
      const o = src.errors!.find(x => x.code === e.code);
      return o ? { ...e, ...(o.label ? { label: o.label } : {}), ...(o.declared ? { declared: true } : {}) } : e;
    });
    const missing = src.errors.filter(o => !o.boundary && !o.side && !own.some(e => e.code === o.code));
    next.errors = [...own, ...missing];
  }
  return next;
}

/**
 * Nach dem Einfügen im Modeler: die neuen Schritte (`pasted.ids`: alte → neue
 * ID) bekommen die Angaben der Quelle, ihre Interaktionen kommen samt
 * In/Out-Klassen als Kopie dazu. `placed`: die neuen IDs der Schritte mit Quelle.
 */
export function overlayPasted(spec: ProcessSpec, pasted: PastedElements): { spec: ProcessSpec; placed: Array<[string, string]> } {
  const src = pasted.spec;
  if (!src) return { spec, placed: [] };
  const present = new Set(allSteps(spec.steps).map(s => s.id));
  const oldIdOf = new Map(Object.entries(pasted.ids).map(([alt, neu]) => [neu, alt]));
  const placed = Object.entries(pasted.ids).filter(([alt, neu]) => present.has(neu) && src.steps[alt]);
  if (!placed.length) return { spec, placed: [] };
  const newIdOf = new Map(placed);

  const steps = mapSteps(spec.steps, s => {
    const alt = oldIdOf.get(s.id);
    const from = alt && newIdOf.has(alt) ? src.steps[alt] : undefined;
    return from ? overlayStep(s, from, oldIdOf) : s;
  });

  // Interaktionen der eingefügten Schritte — mit neuem, eindeutigem Namen
  const iaNames = new Set((spec.interactions ?? []).map(i => i.name));
  const iaMap = new Map<string, { id: string; name: string }>();
  const interactions: Interaction[] = [];
  for (const ia of src.interactions) {
    const stepId = newIdOf.get(ia.stepId);
    if (!stepId) continue;
    const name = uniqueName(ia.name, iaNames);
    iaNames.add(name);
    const id = uid('ia');
    iaMap.set(ia.id, { id, name });
    // `descrExpr` und `pkg` gehören zur Domain der Quelle — die Kopie ist neu
    const { descrExpr: _expr, descrImports: _imports, pkg: _pkg, inTypeId: _in, outTypeId: _out, ...rest } = ia;
    interactions.push({ ...rest, id, name, stepId, key: ia.key === ia.stepId ? stepId : ia.key, status: 'draft' });
  }
  const roots = src.interactions.filter(i => iaMap.has(i.id)).flatMap(i => [i.inTypeId, i.outTypeId]).filter((x): x is string => !!x);
  const { types, idMap } = pasteTypes(spec.types, typeClosure(src.types, roots), iaMap);
  for (const ia of interactions) {
    const orig = src.interactions.find(i => iaMap.get(i.id)?.id === ia.id)!;
    if (orig.inTypeId && idMap.has(orig.inTypeId)) ia.inTypeId = idMap.get(orig.inTypeId);
    if (orig.outTypeId && idMap.has(orig.outTypeId)) ia.outTypeId = idMap.get(orig.outTypeId);
  }

  return {
    spec: {
      ...spec,
      steps,
      ...(interactions.length ? { interactions: [...(spec.interactions ?? []), ...interactions] } : {}),
      ...(types.length ? { types: [...(spec.types ?? []), ...types] } : {}),
    },
    placed: placed.map(([alt, neu]) => [alt, neu]),
  };
}
