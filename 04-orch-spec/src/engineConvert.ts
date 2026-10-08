// BPMN zwischen Camunda 7 und Camunda 8 umwandeln — in beide Richtungen.
//
// Mechanisch, auf dem XML: Layout, IDs, Topics und Namen bleiben, nur die
// Engine-Erweiterungen wechseln die Form (Regeln wie im Migrationsleitfaden
// des bpmn-c7-to-c8-Skills):
//
//   Camunda 7                                  Camunda 8
//   camunda:type="external" camunda:topic      zeebe:taskDefinition type
//   camunda:inputOutput (input/outputParam.)   zeebe:ioMapping (input/output)
//   calledElement + camunda:in / camunda:out   zeebe:calledElement + zeebe:ioMapping
//   camunda:decisionRef / resultVariable       zeebe:calledDecision
//   camunda:assignee / candidateGroups …       zeebe:userTask + assignmentDefinition
//   camunda:collection / elementVariable       zeebe:loopCharacteristics
//   camunda:properties                         zeebe:properties
//   camunda:versionTag                         zeebe:versionTag
//   camunda:modelerTemplate                    zeebe:modelerTemplate (Service-Verweis)
//   ${…} (JUEL)                                =… (FEEL)
//
// Was keine Entsprechung hat, fällt weg — die Engine-Eigenheiten ohne
// Bedeutung für den Ablauf (async, Job-Priorität …) still, alles andere mit
// einer Meldung: Listener, Skripte, Korrelationsschlüssel, nicht
// übersetzbare Ausdrücke. Lieber sichtbar offen als still falsch.

import type { EngineId } from './types';
import { C7_LABEL } from './engineLabels';
import { feelBody, feelToJuel } from './feelJuel';
import { importExpression, isJuel, nullSafeCondition, stripNullSafe } from './juelFeel';
import { appendEl, orderBpmn, prependEl, removeEl } from './xmlFormat';
import type { WriteIssue, WriteResult } from './bpmnWrite';
import { errorListSource, parseErrorList } from './errorCodes';

/** `_handledErrors` / `_regexHandledErrors`: Liste in Camunda 8, Text mit Kommas in Camunda 7 */
const ERROR_LISTS = new Set(['_handledErrors', '_regexHandledErrors']);

const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';
const MODELER_NS = 'http://camunda.org/schema/modeler/1.0';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** Plattform-Angaben für den Modeler */
const PLATFORM: Record<EngineId, { name: string; version: string }> = {
  c7: { name: 'Camunda Platform', version: '7.23.0' },
  c8: { name: 'Camunda Cloud', version: '8.9.0' },
};

/** Camunda-7-Attribute ohne Bedeutung in Camunda 8 — fallen still weg */
const C7_ONLY = new Set([
  'asyncBefore', 'asyncAfter', 'async', 'exclusive', 'jobPriority', 'taskPriority', 'failedJobRetryTimeCycle',
  'historyTimeToLive', 'isStartableInTasklist', 'calledElementBinding', 'calledElementVersion',
  'calledElementVersionTag', 'calledElementTenantId', 'decisionRefBinding', 'decisionRefVersion',
  'decisionRefVersionTag', 'decisionRefTenantId', 'mapDecisionResult', 'diagramRelationId', 'errorMessage', 'initiator',
  'candidateStarterGroups', 'candidateStarterUsers', 'priority',
]);

const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);
const firstNamed = (el: Element, name: string, ns?: string): Element | null =>
  kids(el).find(c => local(c) === name && (!ns || c.namespaceURI === ns)) ?? null;
const inNs = (el: Element, ns: string) => el.namespaceURI === ns;

function descendants(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => { out.push(el); for (const k of kids(el)) walk(k); };
  walk(root);
  return out;
}

/** Engine eines Diagramms — wie der Import sie erkennt */
export const detectEngine = (xml: string): EngineId =>
  /http:\/\/camunda\.org\/schema\/zeebe|executionPlatform="Camunda Cloud"/.test(xml) ? 'c8' : 'c7';

// ── Ausdrücke ────────────────────────────────────────────────────────────────
type Issue = (where: string, text: string) => void;

/** JUEL/Text → FEEL mit `=`; fester Text bleibt fester Text (Timer, Bedingung) */
function toFeel(text: string, where: string, issue: Issue): string {
  const t = text.trim();
  if (!t || t.startsWith('=') || !isJuel(t)) return t;
  const f = importExpression(t);
  if (f.startsWith('= ')) return `=${f.slice(2)}`;
  issue(where, `«${t}» ist nicht nach FEEL übersetzbar — von Hand anpassen.`);
  return t;
}

const feelString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Quelle eines `zeebe:input/output` — dort ist alles FEEL, fester Text also ein String */
function toFeelSource(text: string, where: string, issue: Issue): string {
  const t = text.trim();
  if (!t) return '=null';
  if (t.startsWith('=')) return t;
  if (!isJuel(t)) return `=${feelString(t)}`;
  return toFeel(t, where, issue);
}

/** FEEL → `${…}`; fester Text bleibt */
function toJuel(text: string, where: string, issue: Issue): string {
  const t = text.trim();
  const body = feelBody(t);
  if (body == null) return t;
  const r = feelToJuel(body);
  if (r.ok) return `\${${r.juel}}`;
  issue(where, `«${t}» ist nicht nach JUEL übersetzbar (${r.reason}) — von Hand anpassen.`);
  return t;
}

/** Wert eines `camunda:inputParameter` aus einer zeebe-Quelle: ein FEEL-String wird wieder fester Text */
function toJuelValue(source: string, where: string, issue: Issue): string {
  const body = feelBody(source.trim());
  const lit = body != null ? /^"((?:[^"\\]|\\.)*)"$/.exec(body) : null;
  if (lit) return lit[1].replace(/\\(["\\])/g, '$1');
  return toJuel(source, where, issue);
}

/** blosser Variablenname (`=client`) — für `camunda:in source` */
const plainVar = (source: string): string | null => {
  const b = feelBody(source.trim());
  return b != null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(b) ? b : null;
};

// ── Umwandlung ───────────────────────────────────────────────────────────────
/**
 * Das Diagramm in die Form der Ziel-Engine bringen. Liegt es schon in dieser
 * Form vor, kommt es unverändert zurück.
 */
export function convertBpmn(xml: string, target: EngineId, opts: { timeToLive?: string } = {}): WriteResult & { changed: boolean } {
  const issues: WriteIssue[] = [];
  if (detectEngine(xml) === target) return { xml, issues, changed: false };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const defs = doc.documentElement;
  if (!defs || local(defs) !== 'definitions' || doc.getElementsByTagName('parsererror').length) {
    return { xml, changed: false, issues: [{ stepId: '', where: 'BPMN', text: 'Das Diagramm ist kein lesbares BPMN — nichts umgewandelt.' }] };
  }
  const bpmnPrefix = defs.prefix ? `${defs.prefix}:` : '';
  const ctx: Ctx = {
    doc, issues, later: [],
    bpmnEl: name => doc.createElementNS(defs.namespaceURI, `${bpmnPrefix}${name}`),
  };

  const declare = (prefix: string, uri: string) => {
    if (!defs.hasAttribute(`xmlns:${prefix}`)) defs.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, uri);
  };
  declare(target === 'c8' ? 'zeebe' : 'camunda', target === 'c8' ? ZEEBE_NS : CAMUNDA_NS);
  declare('modeler', MODELER_NS);
  defs.setAttributeNS(MODELER_NS, 'modeler:executionPlatform', PLATFORM[target].name);
  defs.setAttributeNS(MODELER_NS, 'modeler:executionPlatformVersion', PLATFORM[target].version);

  if (target === 'c8') toC8(defs, ctx);
  else toC7(defs, ctx, opts);

  // der Namensraum der alten Engine, wenn nichts mehr darin steht
  const oldNs = target === 'c8' ? CAMUNDA_NS : ZEEBE_NS;
  for (const a of Array.from(defs.attributes)) {
    if (a.name.startsWith('xmlns:') && a.value === oldNs && !usesNs(defs, oldNs)) defs.removeAttribute(a.name);
  }

  orderBpmn(doc);
  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  out = out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n');
  // zwei gleiche Listener am selben Element sind eine Meldung
  const seen = new Set<string>();
  const unique = issues.filter(i => { const k = `${i.stepId}|${i.where}|${i.text}`; return !seen.has(k) && !!seen.add(k); });
  return { xml: out, issues: unique, changed: true };
}

interface Ctx {
  doc: Document;
  issues: WriteIssue[];
  bpmnEl: (name: string) => Element;
  /** Kinder, die erst eingerückt werden können, wenn ihr Elternteil hängt */
  later: Array<[Element, Element[]]>;
}

function usesNs(root: Element, ns: string): boolean {
  return descendants(root).some(e => e.namespaceURI === ns || Array.from(e.attributes).some(a => a.namespaceURI === ns));
}

const idOf = (el: Element): string => {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const id = e.getAttribute('id');
    if (id) return id;
  }
  return '';
};

const issueAt = (ctx: Ctx, el: Element): Issue => (where, text) => ctx.issues.push({ stepId: idOf(el), where, text });

/** `extensionElements` des Elements — angelegt, wenn es fehlt */
function extOf(ctx: Ctx, el: Element): Element {
  let ext = firstNamed(el, 'extensionElements');
  if (!ext) {
    ext = ctx.bpmnEl('extensionElements');
    // vor `documentation` darf nichts stehen
    const doc = firstNamed(el, 'documentation');
    if (doc) el.insertBefore(ext, doc.nextSibling);
    else prependEl(el, ext);
  }
  return ext;
}

function create(ctx: Ctx, ns: string, prefix: string, name: string, attrs: Record<string, string | undefined> = {}): Element {
  const e = ctx.doc.createElementNS(ns, `${prefix}:${name}`);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== '') e.setAttribute(k, v);
  return e;
}

/** Kinder mit Einrückung einfügen */
function fill(parent: Element, children: Element[]) {
  for (const c of children) appendEl(parent, c);
}

/** leer gewordene `extensionElements` entfernen */
function dropEmptyExt(el: Element) {
  const ext = firstNamed(el, 'extensionElements');
  if (ext && !kids(ext).length) removeEl(ext);
}

// ── Camunda 7 → Camunda 8 ────────────────────────────────────────────────────
function toC8(defs: Element, ctx: Ctx) {
  const cattr = (el: Element, name: string) => el.getAttributeNS(CAMUNDA_NS, name);
  const zeebe = (name: string, attrs: Record<string, string | undefined> = {}) => create(ctx, ZEEBE_NS, 'zeebe', name, attrs);
  const touched: Element[] = [];

  for (const el of descendants(defs)) {
    if (inNs(el, CAMUNDA_NS) || inNs(el, ZEEBE_NS)) continue;
    const name = local(el);
    const issue = issueAt(ctx, el);
    const add: Element[] = [];
    const ext0 = firstNamed(el, 'extensionElements');

    // ── External Task: Topic → Job-Typ (bei Nachrichten-Events am Event selbst)
    const topic = cattr(el, 'topic');
    if (topic) {
      const holder = name === 'messageEventDefinition' && el.parentElement ? el.parentElement : el;
      if (holder === el) add.push(zeebe('taskDefinition', { type: topic }));
      else { const e = extOf(ctx, holder); prependEl(e, zeebe('taskDefinition', { type: topic })); touched.push(holder); }
    }
    for (const a of ['class', 'delegateExpression', 'expression']) {
      if (cattr(el, a)) issue('Implementierung', `camunda:${a}="${cattr(el, a)}" — in Camunda 8 als Job-Worker (zeebe:taskDefinition) umsetzen.`);
    }

    // ── Teilprozess: calledElement + in/out
    const io: Element[] = [];
    if (name === 'callActivity') {
      const called = el.getAttribute('calledElement');
      const ins = ext0 ? kids(ext0).filter(k => inNs(k, CAMUNDA_NS) && local(k) === 'in') : [];
      const outs = ext0 ? kids(ext0).filter(k => inNs(k, CAMUNDA_NS) && local(k) === 'out') : [];
      const all = (xs: Element[]) => xs.some(x => x.getAttribute('variables') === 'all');
      add.push(zeebe('calledElement', {
        processId: called ? toFeel(called, 'Aufgerufener Prozess', issue) : undefined,
        propagateAllChildVariables: all(outs) ? 'true' : 'false',
        propagateAllParentVariables: all(ins) ? 'true' : 'false',
      }));
      if (called) el.removeAttribute('calledElement');
      for (const [xs, tag] of [[ins, 'input'], [outs, 'output']] as const) {
        for (const x of xs) {
          if (x.getAttribute('businessKey')) continue; // wird unten als Variable «businessKey» übergeben
          if (x.getAttribute('variables') === 'all') continue;
          const target = x.getAttribute('target') ?? '';
          const src = x.getAttribute('source');
          const expr = x.getAttribute('sourceExpression');
          const where = `${tag === 'input' ? 'Eingabe' : 'Ausgabe'} «${target}»`;
          const source = src ? `=${src}` : toFeelSource(expr ?? '', where, issue);
          io.push(zeebe(tag, { source, target }));
        }
      }
      // Der Business Key geht immer an den Teilprozess — in Camunda 8 als Variable
      if (!io.some(p => local(p) === 'input' && p.getAttribute('target') === 'businessKey')) {
        io.unshift(zeebe('input', { source: '=businessKey', target: 'businessKey' }));
      }
    }

    // ── Listener, die nur eine Variable setzen → Output-Mapping (das übliche
    //    Muster an End-Events: `execution.setVariable("processStatus", "…")`)
    const listeners = ext0 ? kids(ext0).filter(k => inNs(k, CAMUNDA_NS) && local(k) === 'executionListener') : [];
    for (const l of listeners) {
      const sv = setVariableOf(l.getAttribute('expression') ?? '');
      if (!sv) continue;
      io.push(zeebe('output', { source: toFeelSource(`\${${sv.value}}`, `Ausgabe «${sv.name}»`, issue), target: sv.name }));
      removeEl(l);
    }

    // ── lokale Variablen: inputOutput → ioMapping
    const cio = ext0 ? firstNamed(ext0, 'inputOutput', CAMUNDA_NS) : null;
    if (cio) {
      for (const p of kids(cio)) {
        const tag = local(p) === 'inputParameter' ? 'input' : 'output';
        const target = p.getAttribute('name') ?? '';
        const where = `${tag === 'input' ? 'Eingabe' : 'Ausgabe'} «${target}»`;
        const complex = kids(p).find(k => ['script', 'list', 'map'].includes(local(k)));
        if (complex) {
          issue(where, local(complex) === 'script'
            ? 'ist ein Skript — in Camunda 8 als FEEL-Ausdruck neu schreiben.'
            : `ist eine ${local(complex) === 'list' ? 'Liste' : 'Map'} — als FEEL-Ausdruck neu schreiben.`);
          continue;
        }
        if (tag === 'input' && ERROR_LISTS.has(target)) { io.push(zeebe(tag, { source: errorListSource(parseErrorList(p.textContent ?? ''), 'c8'), target })); continue; }
        io.push(zeebe(tag, { source: toFeelSource(p.textContent ?? '', where, issue), target }));
      }
    }
    if (io.length) {
      const m = zeebe('ioMapping');
      add.push(m);
      // Eingaben vor Ausgaben — so will es das Schema
      const sorted = [...io.filter(x => local(x) === 'input'), ...io.filter(x => local(x) === 'output')];
      ctx.later.push([m, sorted]);
    }

    // ── DMN
    const decision = cattr(el, 'decisionRef');
    if (decision) {
      const result = cattr(el, 'resultVariable');
      if (!result) issue('Entscheidung', 'Camunda 8 braucht eine resultVariable — ergänzen.');
      add.push(zeebe('calledDecision', { decisionId: decision, resultVariable: result || undefined }));
      issue('Entscheidung', `Ergebnisform prüfen: Camunda 8 liefert je nach Hit Policy einen Wert, einen Context oder eine Liste (${C7_LABEL} immer eine Liste).`);
    }

    // ── Benutzeraufgabe
    if (name === 'userTask') {
      add.push(zeebe('userTask'));
      const assignee = cattr(el, 'assignee'), groups = cattr(el, 'candidateGroups'), users = cattr(el, 'candidateUsers');
      if (assignee || groups || users) {
        add.push(zeebe('assignmentDefinition', {
          assignee: assignee ? toFeel(assignee, 'Zuständig', issue) : undefined,
          candidateGroups: groups ? toFeel(groups, 'Gruppen', issue) : undefined,
          candidateUsers: users ? toFeel(users, 'Benutzer', issue) : undefined,
        }));
      }
      const due = cattr(el, 'dueDate'), follow = cattr(el, 'followUpDate');
      if (due || follow) {
        add.push(zeebe('taskSchedule', {
          dueDate: due ? toFeel(due, 'Fälligkeit', issue) : undefined,
          followUpDate: follow ? toFeel(follow, 'Wiedervorlage', issue) : undefined,
        }));
      }
    }
    const formKey = cattr(el, 'formKey');
    if (formKey) {
      if (name === 'userTask') add.push(zeebe('formDefinition', { externalReference: formKey }));
      issue('Formular', `formKey «${formKey}» — in Camunda 8 als Formular (externe Referenz) prüfen.`);
    }

    // ── Mehrfachausführung
    if (name === 'multiInstanceLoopCharacteristics') {
      const coll = cattr(el, 'collection'), elem = cattr(el, 'elementVariable');
      if (coll || elem) {
        const lc = zeebe('loopCharacteristics', {
          inputCollection: coll ? toFeelSource(coll, 'Sammlung', issue) : undefined,
          inputElement: elem || undefined,
        });
        add.push(lc);
      }
      if (firstNamed(el, 'loopCardinality')) issue('Mehrfachausführung', 'loopCardinality gibt es in Camunda 8 nicht — über eine Sammlung lösen.');
      const cc = firstNamed(el, 'completionCondition');
      if (cc) cc.textContent = toFeel(cc.textContent ?? '', 'Abschlussbedingung', issue);
    }

    // ── Bedingungen und Timer
    if (name === 'conditionExpression') {
      if (el.getAttribute('language')) issue('Bedingung', `Skript-Bedingung (${el.getAttribute('language')}) — als FEEL neu schreiben.`);
      else {
        // null-sicher wie im Export: in Camunda 7 war `null` einfach `false`
        const feel = toFeel(el.textContent ?? '', 'Bedingung', issue);
        el.textContent = feel.startsWith('=') ? `=${nullSafeCondition(feel.slice(1))}` : feel;
      }
    }
    if (['timeDuration', 'timeDate', 'timeCycle'].includes(name)) {
      el.textContent = toFeel(el.textContent ?? '', 'Timer', issue);
    }

    // ── Nachrichten: wer wartet, braucht einen Korrelationsschlüssel
    if (name === 'messageEventDefinition' || name === 'receiveTask') {
      const holder = name === 'receiveTask' ? el : el.parentElement;
      const waits = holder && ['intermediateCatchEvent', 'boundaryEvent', 'receiveTask'].includes(local(holder));
      const ref = el.getAttribute('messageRef');
      const msg = ref ? descendants(defs).find(m => local(m) === 'message' && m.getAttribute('id') === ref) : null;
      if (waits && msg) {
        const mext = extOf(ctx, msg);
        if (!firstNamed(mext, 'subscription', ZEEBE_NS)) {
          appendEl(mext, zeebe('subscription', { correlationKey: '=businessKey' }));
          issueAt(ctx, holder)('Nachricht', `«${msg.getAttribute('name') ?? ref}» — Korrelationsschlüssel «=businessKey» vorgeschlagen, prüfen.`);
        }
      }
    }
    if (name === 'message') {
      const n = el.getAttribute('name');
      if (n && isJuel(n)) el.setAttribute('name', toFeel(n, 'Nachrichtenname', issue));
    }

    // ── Element-Template: der Verweis auf den Service bleibt
    for (const a of TEMPLATE_ATTRS) {
      const v = cattr(el, a);
      if (v) el.setAttributeNS(ZEEBE_NS, `zeebe:${a}`, v);
    }

    // ── Prozess
    if (name === 'process') {
      const tag = cattr(el, 'versionTag');
      if (tag) add.push(zeebe('versionTag', { value: tag }));
    }

    // ── Eigenschaften
    const props = ext0 ? firstNamed(ext0, 'properties', CAMUNDA_NS) : null;
    if (props) {
      const zp = zeebe('properties');
      ctx.later.push([zp, kids(props).map(p => zeebe('property', { name: p.getAttribute('name') ?? '', value: p.getAttribute('value') ?? '' }))]);
      add.push(zp);
    }

    // ── was bleibt: melden und entfernen
    if (ext0) {
      for (const k of kids(ext0).filter(k => inNs(k, CAMUNDA_NS))) {
        const n = local(k);
        if (!['in', 'out', 'inputOutput', 'properties'].includes(n)) {
          issue(n === 'executionListener' || n === 'taskListener' ? 'Listener' : 'Erweiterung',
            n === 'executionListener' || n === 'taskListener'
              ? `camunda:${n} entfernt — in Camunda 8 als Job-Worker-Listener oder Output-Mapping umsetzen.`
              : `camunda:${n} entfernt — hat in Camunda 8 kein Gegenstück.`);
        }
        removeEl(k);
      }
    }
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI !== CAMUNDA_NS) continue;
      const n = a.localName;
      const handled = ['type', 'topic', 'class', 'delegateExpression', 'expression', 'decisionRef', 'resultVariable',
        'assignee', 'candidateGroups', 'candidateUsers', 'dueDate', 'followUpDate', 'formKey', 'collection',
        'elementVariable', 'versionTag', ...TEMPLATE_ATTRS];
      if (!handled.includes(n) && !C7_ONLY.has(n)) issue('Erweiterung', `camunda:${n}="${a.value}" entfernt — hat in Camunda 8 kein Gegenstück.`);
      el.removeAttributeNode(a);
    }
    if (name === 'scriptTask') issue('Skript', 'Skript-Aufgabe — in Camunda 8 als FEEL (zeebe:script) oder Job-Worker umsetzen.');

    if (add.length) {
      const ext = extOf(ctx, el);
      fill(ext, add);
    }
    touched.push(el);
  }

  for (const [parent, children] of ctx.later) fill(parent, children);
  for (const el of touched) dropEmptyExt(el);
}

// ── Camunda 8 → Camunda 7 ────────────────────────────────────────────────────
function toC7(defs: Element, ctx: Ctx, opts: { timeToLive?: string }) {
  const setC = (el: Element, name: string, value: string | undefined) => {
    if (value !== undefined && value !== '') el.setAttributeNS(CAMUNDA_NS, `camunda:${name}`, value);
  };
  const camunda = (name: string, attrs: Record<string, string | undefined> = {}) => create(ctx, CAMUNDA_NS, 'camunda', name, attrs);
  const touched: Element[] = [];

  for (const el of descendants(defs)) {
    if (inNs(el, CAMUNDA_NS) || inNs(el, ZEEBE_NS)) continue;
    const name = local(el);
    const issue = issueAt(ctx, el);
    const ext = firstNamed(el, 'extensionElements');
    const z = (n: string) => (ext ? firstNamed(ext, n, ZEEBE_NS) : null);
    const add: Element[] = [];

    // ── Job-Typ → External Task (bei Nachrichten-Events an der Ereignisdefinition)
    const task = z('taskDefinition');
    if (task) {
      const type = toJuel(task.getAttribute('type') ?? '', 'Job-Typ', issue);
      const med = firstNamed(el, 'messageEventDefinition');
      const holder = ['intermediateThrowEvent', 'endEvent'].includes(name) && med ? med : el;
      setC(holder, 'type', 'external');
      setC(holder, 'topic', type);
    }

    // ── Teilprozess
    const called = z('calledElement');
    const ioM = z('ioMapping');
    const io = ioM ? kids(ioM) : [];
    if (name === 'callActivity') {
      if (called) {
        const pid = called.getAttribute('processId') ?? '';
        el.setAttribute('calledElement', pid.startsWith('=') ? toJuel(pid, 'Aufgerufener Prozess', issue) : pid);
        // Vorgabe in Camunda 8: beides «true»
        if (called.getAttribute('propagateAllParentVariables') !== 'false') add.push(camunda('in', { variables: 'all' }));
        if (called.getAttribute('propagateAllChildVariables') !== 'false') add.push(camunda('out', { variables: 'all' }));
      }
      // Der Business Key geht immer an den Teilprozess — Camunda 7 hat dafür `camunda:in businessKey`
      add.push(camunda('in', { businessKey: '#{execution.processBusinessKey}' }));
      for (const p of io) {
        const tag = local(p) === 'input' ? 'in' : 'out';
        const target = p.getAttribute('target') ?? '';
        if (tag === 'in' && target === 'businessKey') continue;
        const source = p.getAttribute('source') ?? '';
        const where = `${tag === 'in' ? 'Eingabe' : 'Ausgabe'} «${target}»`;
        const plain = plainVar(source);
        add.push(plain
          ? camunda(tag, { source: plain, target })
          : camunda(tag, { sourceExpression: source.trim().startsWith('=') ? toJuel(source, where, issue) : source, target }));
      }
    } else if (io.length && EVENTS.has(name) && io.every(p => local(p) === 'output')) {
      // Camunda 7 kennt kein Output-Mapping an Ereignissen — dort setzt ein
      // Listener die Variable (das Muster, aus dem es in Camunda 8 wurde)
      for (const p of io) {
        const target = p.getAttribute('target') ?? '';
        const juel = toJuel(p.getAttribute('source') ?? '', `Ausgabe «${target}»`, issue);
        const value = /^\$\{([\s\S]*)\}$/.exec(juel)?.[1] ?? JSON.stringify(juel);
        add.push(camunda('executionListener', { expression: `\${execution.setVariable(${JSON.stringify(target)}, ${value})}`, event: 'start' }));
      }
    } else if (io.length) {
      const cio = camunda('inputOutput');
      const params = io.map(p => {
        const tag = local(p) === 'input' ? 'inputParameter' : 'outputParameter';
        const target = p.getAttribute('target') ?? '';
        const e = camunda(tag, { name: target });
        if (tag === 'inputParameter' && ERROR_LISTS.has(target)) {
          e.textContent = errorListSource(parseErrorList(p.getAttribute('source') ?? ''), 'c7', (x, why) => issue(`Eingabe «${target}»`, `«${x}» ist nicht nach JUEL übersetzbar (${why}) — von Hand anpassen.`));
          return e;
        }
        e.textContent = toJuelValue(p.getAttribute('source') ?? '', `${tag === 'inputParameter' ? 'Eingabe' : 'Ausgabe'} «${target}»`, issue);
        return e;
      });
      ctx.later.push([cio, params]);
      add.push(cio);
    }

    // ── DMN
    const dec = z('calledDecision');
    if (dec) {
      setC(el, 'decisionRef', dec.getAttribute('decisionId') ?? '');
      setC(el, 'resultVariable', dec.getAttribute('resultVariable') ?? '');
      issue('Entscheidung', `Ergebnisform prüfen: ${C7_LABEL} liefert per Vorgabe eine Liste (mapDecisionResult).`);
    }

    // ── Benutzeraufgabe
    const assign = z('assignmentDefinition');
    if (assign) {
      setC(el, 'assignee', toJuelAttr(assign.getAttribute('assignee'), 'Zuständig', issue));
      setC(el, 'candidateGroups', toJuelAttr(assign.getAttribute('candidateGroups'), 'Gruppen', issue));
      setC(el, 'candidateUsers', toJuelAttr(assign.getAttribute('candidateUsers'), 'Benutzer', issue));
    }
    const sched = z('taskSchedule');
    if (sched) {
      setC(el, 'dueDate', toJuelAttr(sched.getAttribute('dueDate'), 'Fälligkeit', issue));
      setC(el, 'followUpDate', toJuelAttr(sched.getAttribute('followUpDate'), 'Wiedervorlage', issue));
    }
    const form = z('formDefinition');
    if (form) {
      const key = form.getAttribute('externalReference') ?? form.getAttribute('formKey') ?? form.getAttribute('formId');
      if (key) setC(el, 'formKey', key);
      issue('Formular', `Formular «${key ?? ''}» — in ${C7_LABEL} als formKey prüfen.`);
    }

    // ── Mehrfachausführung
    if (name === 'multiInstanceLoopCharacteristics') {
      const lc = z('loopCharacteristics');
      if (lc) {
        const coll = lc.getAttribute('inputCollection');
        if (coll) setC(el, 'collection', coll.trim().startsWith('=') ? toJuel(coll, 'Sammlung', issue) : coll);
        setC(el, 'elementVariable', lc.getAttribute('inputElement') ?? '');
        if (lc.getAttribute('outputCollection')) issue('Mehrfachausführung', `outputCollection/outputElement gibt es in ${C7_LABEL} nicht — Ergebnisse von Hand sammeln.`);
      }
      const cc = firstNamed(el, 'completionCondition');
      if (cc) cc.textContent = toJuel(cc.textContent ?? '', 'Abschlussbedingung', issue);
    }

    // ── Bedingungen und Timer
    // die Hülle `(…) = true` braucht Camunda 7 nicht — dort ist `null` ohnehin `false`
    if (name === 'conditionExpression') el.textContent = toJuel(stripNullSafe(el.textContent ?? '').replace(/^= /, '='), 'Bedingung', issue);
    if (['timeDuration', 'timeDate', 'timeCycle'].includes(name)) el.textContent = toJuel(el.textContent ?? '', 'Timer', issue);
    if (name === 'message') {
      const n = el.getAttribute('name');
      if (n?.startsWith('=')) el.setAttribute('name', toJuel(n, 'Nachrichtenname', issue));
    }

    // ── Prozess
    if (name === 'process') {
      const tag = z('versionTag');
      if (tag) setC(el, 'versionTag', tag.getAttribute('value') ?? '');
      if (!el.getAttributeNS(CAMUNDA_NS, 'historyTimeToLive')) {
        if (opts.timeToLive) setC(el, 'historyTimeToLive', opts.timeToLive);
        else issue('Prozess', `${C7_LABEL} verlangt historyTimeToLive — in der Spezifikation setzen.`);
      }
    }

    // ── Eigenschaften
    const zp = z('properties');
    if (zp) {
      const cp = camunda('properties');
      ctx.later.push([cp, kids(zp).map(p => camunda('property', { name: p.getAttribute('name') ?? '', value: p.getAttribute('value') ?? '' }))]);
      add.push(cp);
    }

    // ── was bleibt: melden und entfernen
    if (ext) {
      const handled = ['taskDefinition', 'calledElement', 'ioMapping', 'calledDecision', 'assignmentDefinition',
        'taskSchedule', 'formDefinition', 'loopCharacteristics', 'versionTag', 'properties', 'userTask', 'subscription'];
      for (const k of kids(ext).filter(k => inNs(k, ZEEBE_NS))) {
        const n = local(k);
        if (!handled.includes(n)) {
          issue(n.endsWith('Listeners') ? 'Listener' : 'Erweiterung', n.endsWith('Listeners')
            ? `zeebe:${n} entfernt — in ${C7_LABEL} als camunda:${n.replace(/s$/, '')} umsetzen.`
            : `zeebe:${n} entfernt — hat in ${C7_LABEL} kein Gegenstück.`);
        }
        removeEl(k);
      }
    }
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI !== ZEEBE_NS) continue;
      if (TEMPLATE_ATTRS.includes(a.localName)) setC(el, a.localName, a.value);
      el.removeAttributeNode(a);
    }

    if (add.length) fill(extOf(ctx, el), add);
    touched.push(el);
  }

  for (const [parent, children] of ctx.later) fill(parent, children);
  for (const el of touched) dropEmptyExt(el);
}

/** Verweis aufs Element-Template — in beiden Engines gleich, nur im anderen Namensraum */
const TEMPLATE_ATTRS = ['modelerTemplate', 'modelerTemplateVersion', 'modelerTemplateIcon'];

/** Ereignisse, an denen Camunda 7 kein Output-Mapping kennt — dort setzt es ein Listener */
const EVENTS = new Set(['startEvent', 'endEvent', 'boundaryEvent']);

/** `${execution.setVariable("x", v)}` → { name: x, value: v } */
function setVariableOf(expression: string): { name: string; value: string } | null {
  const m = /^[$#]\{\s*execution\.setVariable\(\s*(["'])([^"']+)\1\s*,\s*([\s\S]+?)\s*\)\s*\}$/.exec(expression.trim());
  return m ? { name: m[2], value: m[3] } : null;
}

function toJuelAttr(v: string | null, where: string, issue: Issue): string | undefined {
  if (!v) return undefined;
  return v.trim().startsWith('=') ? toJuel(v, where, issue) : v;
}
