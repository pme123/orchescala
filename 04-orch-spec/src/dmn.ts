// DMN tables of a DMN decision — like the BPMN for the flow: the table is
// the source, the app derives.
//
//  · Input columns → fields of the `In` (type from `typeRef`), output columns →
//    fields of the `Out`. Description, example and `optional` are kept via the
//    name — like the business texts in the sync with the BPMN.
//  · Hit policy and number of outputs → result form (`decisionResult`), like
//    the factories in Orchescala (BpmnDecisionDsl).
//  · Storage: `processes/<slug>/<decisionId>.dmn` next to the specification; into the
//    project (`src/main/resources/camunda` or `camunda8`) the
//    helper brings them (`processFromSpec`).
import type { DecisionResult, EngineId, Field, Interaction, ProcessSpec, TypeDef } from './types.ts';
import { uid } from './util.ts';

export const DMN_NS = 'https://www.omg.org/spec/DMN/20191111/MODEL/';

export interface DmnColumn {
  /** Field name: the expression of the input (`allPoaStatus90`) or `name` of the output */
  name: string;
  label?: string;
  /** `typeRef` of the column — `string`, `integer`, `number`, `boolean`, `date` … */
  typeRef?: string;
}

export interface DmnDecision {
  id: string;
  name?: string;
  hitPolicy: string;
  aggregation?: string;
  inputs: DmnColumn[];
  outputs: DmnColumn[];
}

const local = (el: Element) => (el.localName || el.tagName || '').replace(/^.*:/, '');
const kids = (el: Element, name: string) => Array.from(el.children).filter(c => local(c) === name);

/** «Status 90 aller Vollmachten» → `status90AllerVollmachten` */
function camel(text: string): string {
  const parts = text.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const s = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join('');
  return /^\d/.test(s) ? `n${s}` : s;
}

/** The decisions of a DMN file — only those with a table (decision DMNs, as Orchescala knows them). */
export function parseDmn(xml: string): DmnDecision[] | { error: string } {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (doc.getElementsByTagName('parsererror').length) return { error: 'keine lesbare DMN-Datei' };
  const root = doc.documentElement;
  if (local(root) !== 'definitions') return { error: 'keine DMN-Datei (definitions fehlt)' };
  const out: DmnDecision[] = [];
  for (const d of kids(root, 'decision')) {
    const table = kids(d, 'decisionTable')[0];
    if (!table) continue;
    const inputs = kids(table, 'input').map((inp, i) => {
      const ex = kids(inp, 'inputExpression')[0];
      const text = (ex ? kids(ex, 'text')[0]?.textContent : '')?.trim() ?? '';
      const label = inp.getAttribute('label')?.trim() || undefined;
      // the expression is mostly the name of the process variable — otherwise the label
      const name = /^[A-Za-z_]\w*$/.test(text) ? text : camel(label ?? text) || `input${i + 1}`;
      return { name, label, typeRef: ex?.getAttribute('typeRef') ?? undefined };
    });
    const outputs = kids(table, 'output').map((o, i) => {
      const label = o.getAttribute('label')?.trim() || undefined;
      const name = o.getAttribute('name')?.trim() || camel(label ?? '') || `output${i + 1}`;
      return { name, label, typeRef: o.getAttribute('typeRef') ?? undefined };
    });
    out.push({
      id: d.getAttribute('id') ?? '',
      name: d.getAttribute('name') ?? undefined,
      hitPolicy: (table.getAttribute('hitPolicy') ?? 'UNIQUE').toUpperCase(),
      aggregation: table.getAttribute('aggregation')?.toUpperCase() || undefined,
      inputs,
      outputs,
    });
  }
  return out;
}

/** The decision with this ID (the spelling may differ between BPMN and DMN) */
export function findDecision(xml: string, decisionId: string): DmnDecision | null {
  const all = parseDmn(xml);
  if ('error' in all) return null;
  return all.find(d => d.id.toLowerCase() === decisionId.toLowerCase()) ?? null;
}

/**
 * The result form from the table: one output is a simple value,
 * several an object; COLLECT (without aggregation), RULE ORDER and OUTPUT
 * ORDER yield a list of them. With aggregation (SUM, COUNT …) it stays
 * a single value.
 */
export function decisionResultOf(d: DmnDecision): DecisionResult {
  const list = ['RULE ORDER', 'OUTPUT ORDER'].includes(d.hitPolicy) || (d.hitPolicy === 'COLLECT' && !d.aggregation);
  const one = d.outputs.length <= 1;
  return list ? (one ? 'collectEntries' : 'resultList') : (one ? 'singleEntry' : 'singleResult');
}

/** `typeRef` → Scala type. In Camunda 7 `date` is a timestamp, in Camunda 8 a date. */
export function scalaTypeOf(typeRef: string | undefined, engine: EngineId | undefined): string | null {
  switch ((typeRef ?? '').trim().toLowerCase()) {
    case 'string': return 'String';
    case 'boolean': return 'Boolean';
    case 'integer': case 'int': return 'Int';
    case 'long': return 'Long';
    case 'double': case 'number': return 'Double';
    case 'date': return engine === 'c8' ? 'LocalDate' : 'LocalDateTime';
    case 'datetime': case 'date and time': return 'LocalDateTime';
    default: return null;
  }
}

/** Scala type → `typeRef` of the engine — a selection (enum) is a text */
export function typeRefOf(type: string, engine: EngineId | undefined): string {
  const c8 = engine === 'c8';
  switch (type) {
    case 'Boolean': return 'boolean';
    case 'Int': return c8 ? 'number' : 'integer';
    case 'Long': return c8 ? 'number' : 'long';
    case 'Double': return c8 ? 'number' : 'double';
    case 'LocalDate': return 'date';
    case 'LocalDateTime': return c8 ? 'dateTime' : 'date';
    default: return 'string';
  }
}

/** The fields of a member according to the columns — existing ones keep their details */
function syncFields(old: Field[] | undefined, cols: DmnColumn[], engine: EngineId | undefined): Field[] {
  const byName = new Map((old ?? []).map(f => [f.name, f]));
  return cols.map(col => {
    const type = scalaTypeOf(col.typeRef, engine);
    const prev = byName.get(col.name);
    if (prev) return type ? { ...prev, type } : prev;
    return {
      id: uid('f'), name: col.name, type: type ?? 'String',
      ...(col.label && col.label !== col.name ? { description: col.label } : {}),
    };
  });
}

export interface DmnSync {
  spec: ProcessSpec;
  /** what has changed, readable — empty if everything already fit */
  changes: string[];
}

/**
 * `In` and `Out` of the interaction `iaId` according to the table — missing classes
 * are created, fields without a column are dropped, the result form follows the table.
 */
export function syncDecision(spec: ProcessSpec, iaId: string, d: DmnDecision): DmnSync {
  const ia = (spec.interactions ?? []).find(i => i.id === iaId);
  if (!ia) return { spec, changes: [] };
  let types = [...(spec.types ?? [])];
  const changes: string[] = [];
  const member = (key: 'inTypeId' | 'outTypeId', name: 'In' | 'Out', cols: DmnColumn[]): string => {
    const cur = types.find(t => t.id === ia[key]);
    const fields = syncFields(cur?.fields, cols, spec.engine);
    const before = (cur?.fields ?? []).map(f => `${f.name}:${f.type}`).join(',');
    const after = fields.map(f => `${f.name}:${f.type}`).join(',');
    if (before !== after) changes.push(`${name}: ${fields.map(f => f.name).join(', ') || '—'}`);
    if (cur) {
      types = types.map(t => (t.id === cur.id ? { ...t, fields } : t));
      return cur.id;
    }
    const t: TypeDef = { id: uid('t'), name: `${ia.name}.${name}`, kind: 'case', interactionId: ia.id, status: 'draft', fields };
    types.push(t);
    return t.id;
  };
  const inTypeId = member('inTypeId', 'In', d.inputs);
  const outTypeId = member('outTypeId', 'Out', d.outputs);
  const decisionResult = decisionResultOf(d);
  if ((ia.decisionResult ?? 'singleResult') !== decisionResult) changes.push(`Ergebnis: ${decisionResult}`);
  const next: Interaction = { ...ia, inTypeId, outTypeId, decisionResult };
  return {
    spec: { ...spec, types, interactions: (spec.interactions ?? []).map(i => (i.id === ia.id ? next : i)) },
    changes,
  };
}

const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * A new table from `In` and `Out` — one column per field, without rules.
 * Hit policy according to the result form; header for the engine (Camunda Modeler).
 */
export function newDmn(decisionId: string, name: string, inFields: Field[], outFields: Field[], form: DecisionResult, engine: EngineId | undefined): string {
  const c8 = engine === 'c8';
  const hit = form === 'collectEntries' || form === 'resultList' ? 'COLLECT' : 'UNIQUE';
  const inputs = inFields.filter(f => f.name).map((f, i) => `      <input id="Input_${i + 1}" label="${xmlAttr(f.description || f.name)}">
        <inputExpression id="InputExpression_${i + 1}" typeRef="${typeRefOf(f.type, engine)}">
          <text>${xmlText(f.name)}</text>
        </inputExpression>
      </input>`).join('\n');
  const outputs = (outFields.length ? outFields.filter(f => f.name) : [{ name: 'result', type: 'String' } as Field])
    .map((f, i) => `      <output id="Output_${i + 1}" label="${xmlAttr(f.description || f.name)}" name="${xmlAttr(f.name)}" typeRef="${typeRefOf(f.type, engine)}" />`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="${DMN_NS}" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Definitions_${uid('d').slice(2)}" name="${xmlAttr(name)}" namespace="http://camunda.org/schema/1.0/dmn" modeler:executionPlatform="${c8 ? 'Camunda Cloud' : 'Camunda Platform'}" modeler:executionPlatformVersion="${c8 ? '8.6.0' : '7.21.0'}">
  <decision id="${xmlAttr(decisionId)}" name="${xmlAttr(name)}">
    <decisionTable id="DecisionTable_1" hitPolicy="${hit}">
${inputs}
${outputs}
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="DMNDiagram_1">
      <dmndi:DMNShape id="DMNShape_1" dmnElementRef="${xmlAttr(decisionId)}">
        <dc:Bounds height="80" width="180" x="160" y="100" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;
}

/** File name in the project — like the BPMN, the ID without company: `product-orderCardV1-SubStatusKeyDmn.dmn` */
export function dmnFileName(ia: Pick<Interaction, 'key' | 'dmnFile'>, company: string | undefined): string {
  if (typeof ia.dmnFile === 'string' && ia.dmnFile) return ia.dmnFile;
  const id = ia.key ?? 'decision';
  return `${company && id.startsWith(`${company}-`) ? id.slice(company.length + 1) : id}.dmn`;
}

/** Storage next to the specification */
export const dmnPath = (dir: string, slug: string, decisionId: string) => `${dir}/${slug}/${decisionId}.dmn`;
