// Copy and paste: what moves with the elements into another specification
// (or the same one) — without UI, so that it can be tested.
//
// Rules:
//  · Everything pasted is a **draft** — in the target it is not implemented yet.
//  · Classes always come **as a copy**, including the referenced ones; with
//    the same name with a counter (`Address2`). New IDs for classes, fields and
//    interactions — comments of the source do not come along.
//  · References into the catalog (`dom:…`, `svc:…`) and simple types stay.
//  · In the diagram bpmn-js assigns the IDs; `overlayPasted` then attaches the
//    details of the source to the new steps (see clipboard.ts).
import type { Field, Interaction, ProcessSpec, Step, TypeDef } from './types.ts';
import { allSteps } from './bpmn.ts';
import { uid } from './util.ts';
import type { ClipSource, DiagramSpec, PastedElements } from './clipboard.ts';

// ── Data model ───────────────────────────────────────────────────────────────

/** All fields of a class — for a choice also those of the cases */
const fieldsOf = (t: TypeDef): Field[] => [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])];

/**
 * The own classes from `rootIds` including all own classes their
 * fields (also in the cases of a choice) refer to — in the order they are
 * found, the roots first.
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

/** `Address` → `Address2`, `Address2` → `Address3` — until the name is free */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const m = /^(.*\D)(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}

/** A field with a new ID; the type points to the copy where there is one. */
const copyField = (f: Field, idMap: Map<string, string>): Field => ({
  ...f,
  id: uid('f'),
  type: idMap.get(f.type) ?? f.type,
});

/**
 * Classes as copies for the target `target`: new IDs, unique names,
 * draft, without the roles of the source (process In/Out, InitIn, InConfig …).
 * `interactions`: classes of these interactions stay their In/Out — under
 * the new name of the interaction (`<Name>.In`).
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

/** Paste a copied class — returns the new classes and the ID of the pasted one. */
export function pasteType(spec: ProcessSpec, clip: { typeId: string; types: TypeDef[] }): { types: TypeDef[]; id: string } {
  const { types, idMap } = pasteTypes(spec.types, clip.types);
  return { types: [...(spec.types ?? []), ...types], id: idMap.get(clip.typeId)! };
}

/**
 * Attach a copied field to the class `typeId` — for a choice to
 * case number `valueIndex`, not to the shared fields. The name becomes unique in the
 * class (`street2`); classes the field refers to come along as a
 * copy. `null` if the class does not exist.
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
  // Case of a choice: the shared fields count too — otherwise the name would exist twice
  const siblings = value ? [...(t.fields ?? []), ...(value.fields ?? [])] : (t.fields ?? []);
  const field = { ...copyField(clip.field, idMap), name: uniqueName(clip.field.name, new Set(siblings.map(f => f.name))) };
  const next: TypeDef = value
    ? { ...t, values: t.values!.map(v => (v === value ? { ...v, fields: [...(v.fields ?? []), field] } : v)) }
    : { ...t, fields: [...(t.fields ?? []), field] };
  return { types: [...(spec.types ?? []).map(x => (x.id === typeId ? next : x)), ...added], fieldId: field.id };
}

// ── Diagram ──────────────────────────────────────────────────────────────────

/** A step without its nested steps — those come as separate entries */
const flat = (s: Step): Step => {
  const { children: _children, ...rest } = s;
  return {
    ...rest,
    ...(s.branches ? { branches: s.branches.map(b => ({ ...b, steps: [] })) } : {}),
    ...(s.errors ? { errors: s.errors.map(({ steps: _steps, ...e }) => e) } : {}),
  };
};

/** The specification part of the elements `ids` copied in the Modeler */
export function collectDiagram(spec: ProcessSpec, ids: string[], source: ClipSource): DiagramSpec {
  const wanted = new Set(ids);
  const steps = Object.fromEntries(allSteps(spec.steps).filter(s => wanted.has(s.id)).map(s => [s.id, flat(s)]));
  const interactions = (spec.interactions ?? []).filter(i => wanted.has(i.stepId));
  const roots = interactions.flatMap(i => [i.inTypeId, i.outTypeId]).filter((x): x is string => !!x);
  return { source, steps, interactions, types: typeClosure(spec.types, roots) };
}

/**
 * What the specification defines and is not (reliably) in the BPMN: it
 * applies as it was in the source — even if empty.
 */
const SPEC_KEYS = ['description', 'serviceId', 'topic', 'calledProcess', 'inputs', 'outputs',
  'inVariant', 'outVariant', 'mock', 'mockKind'] as const;
/** What is also in the BPMN: from the source where it has it — otherwise as in the diagram. */
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

/** Put the details of the source step `src` onto the pasted step `s`. */
function overlayStep(s: Step, src: Step, oldIdOf: Map<string, string>): Step {
  const next: Step = { ...s, status: 'draft' };
  for (const k of SPEC_KEYS) {
    if (src[k] === undefined) delete next[k];
    else next[k] = src[k] as never;
  }
  for (const k of BPMN_KEYS) if (src[k] !== undefined) next[k] = src[k] as never;
  // Branches: label and condition via the flow the new one is copied from
  if (s.branches && src.branches) {
    next.branches = s.branches.map(b => {
      const o = src.branches!.find(x => x.id === oldIdOf.get(b.id));
      return o ? { ...b, label: o.label || b.label, ...(o.condition !== undefined ? { condition: o.condition } : {}) } : b;
    });
  }
  // Errors: labels by code; handled errors without a boundary event
  // are otherwise only in `_handledErrors` — that would be lost when switching the engine
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
 * After pasting in the Modeler: the new steps (`pasted.ids`: old → new
 * ID) get the details of the source, their interactions are added as a copy including
 * In/Out classes. `placed`: the new IDs of the steps with a source.
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

  // Interactions of the pasted steps — with a new, unique name
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
    // `descrExpr` and `pkg` belong to the domain of the source — the copy is new
    const { descrExpr: _expr, descrImports: _imports, pkg: _pkg, inTypeId: _in, outTypeId: _out, ...rest } = ia;
    interactions.push({ ...rest, id, name, stepId, key: ia.key === ia.stepId ? stepId : ia.key, status: 'draft' });
  }
  const roots = src.interactions.filter(i => iaMap.has(i.id)).flatMap(i => [i.inTypeId, i.outTypeId]).filter((x): x is string => !!x);
  const { types, idMap } = pasteTypes(spec.types, typeClosure(src.types, roots), iaMap);
  for (const ia of interactions) {
    const orig = src.interactions.find(i => iaMap.get(i.id)?.id === ia.id)!;
    if (orig.inTypeId && idMap.has(orig.inTypeId)) ia.inTypeId = idMap.get(orig.inTypeId);
    if (orig.outTypeId && idMap.has(orig.outTypeId)) ia.outTypeId = idMap.get(orig.outTypeId);
    // an alias to an interaction copied along follows it; one to another
    // of the source is dropped (its fields came along as a copy), one to the domain stays
    for (const key of ['inAlias', 'outAlias'] as const) {
      const ref = ia[key];
      if (!ref || ref.startsWith('dom:')) continue;
      const dot = ref.lastIndexOf('.');
      const to = iaMap.get(ref.slice(0, dot));
      if (to) ia[key] = `${to.id}${ref.slice(dot)}`;
      else delete ia[key];
    }
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
