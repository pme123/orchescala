// DMN-Tabellen einer DMN Decision — wie das BPMN zum Ablauf: die Tabelle ist
// die Quelle, die App leitet ab.
//
//  · Eingabespalten → Felder des `In` (Typ aus `typeRef`), Ausgabespalten →
//    Felder des `Out`. Beschreibung, Beispiel und `optional` bleiben über den
//    Namen erhalten — wie die fachlichen Texte beim Abgleich mit dem BPMN.
//  · Hit-Policy und Zahl der Ausgaben → Ergebnisform (`decisionResult`), wie
//    die Fabriken in Orchescala (BpmnDecisionDsl).
//  · Ablage: `processes/<slug>/<decisionId>.dmn` neben der Spezifikation; ins
//    Projekt (`src/main/resources/camunda` bzw. `camunda8`) bringt sie der
//    Helper (`processFromSpec`).
import type { DecisionResult, EngineId, Field, Interaction, ProcessSpec, TypeDef } from './types.ts';
import { uid } from './util.ts';

export const DMN_NS = 'https://www.omg.org/spec/DMN/20191111/MODEL/';

export interface DmnColumn {
  /** Feldname: der Ausdruck der Eingabe (`allPoaStatus90`) bzw. `name` der Ausgabe */
  name: string;
  label?: string;
  /** `typeRef` der Spalte — `string`, `integer`, `number`, `boolean`, `date` … */
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

/** Die Entscheidungen einer DMN-Datei — nur die mit Tabelle (Decision DMNs, wie Orchescala sie kennt). */
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
      // der Ausdruck ist meist der Name der Prozessvariable — sonst die Beschriftung
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

/** Die Entscheidung mit dieser ID (die Schreibweise kann zwischen BPMN und DMN abweichen) */
export function findDecision(xml: string, decisionId: string): DmnDecision | null {
  const all = parseDmn(xml);
  if ('error' in all) return null;
  return all.find(d => d.id.toLowerCase() === decisionId.toLowerCase()) ?? null;
}

/**
 * Die Ergebnisform aus der Tabelle: eine Ausgabe ist ein einfacher Wert,
 * mehrere ein Objekt; COLLECT (ohne Aggregation), RULE ORDER und OUTPUT
 * ORDER liefern eine Liste davon. Mit Aggregation (SUM, COUNT …) bleibt es
 * ein einzelner Wert.
 */
export function decisionResultOf(d: DmnDecision): DecisionResult {
  const list = ['RULE ORDER', 'OUTPUT ORDER'].includes(d.hitPolicy) || (d.hitPolicy === 'COLLECT' && !d.aggregation);
  const one = d.outputs.length <= 1;
  return list ? (one ? 'collectEntries' : 'resultList') : (one ? 'singleEntry' : 'singleResult');
}

/** `typeRef` → Scala-Typ. In Camunda 7 ist `date` ein Zeitpunkt, in Camunda 8 ein Datum. */
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

/** Scala-Typ → `typeRef` der Engine — eine Auswahl (enum) ist ein Text */
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

/** Die Felder eines Members nach den Spalten — Bestehendes behält seine Angaben */
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
  /** was sich geändert hat, lesbar — leer, wenn alles schon passte */
  changes: string[];
}

/**
 * `In` und `Out` der Interaktion `iaId` nach der Tabelle — fehlende Klassen
 * entstehen, Felder ohne Spalte fallen weg, die Ergebnisform folgt der Tabelle.
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
 * Eine neue Tabelle aus `In` und `Out` — je Feld eine Spalte, ohne Regeln.
 * Hit-Policy nach der Ergebnisform; Kopf für die Engine (Camunda Modeler).
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

/** Dateiname im Projekt — wie beim BPMN die ID ohne Firma: `product-orderCardV1-SubStatusKeyDmn.dmn` */
export function dmnFileName(ia: Pick<Interaction, 'key' | 'dmnFile'>, company: string | undefined): string {
  if (typeof ia.dmnFile === 'string' && ia.dmnFile) return ia.dmnFile;
  const id = ia.key ?? 'decision';
  return `${company && id.startsWith(`${company}-`) ? id.slice(company.length + 1) : id}.dmn`;
}

/** Ablage neben der Spezifikation */
export const dmnPath = (dir: string, slug: string, decisionId: string) => `${dir}/${slug}/${decisionId}.dmn`;
