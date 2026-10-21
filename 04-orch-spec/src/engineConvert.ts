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

import type { EngineId } from './types.ts';
import { C7_LABEL, C8_LABEL } from './engineLabels.ts';
import { feelBody, feelToJuel } from './feelJuel.ts';
import { importExpression, isJuel, nullSafeCondition, stripNullSafe } from './juelFeel.ts';
import { appendEl, orderBpmn, prependEl, removeEl } from './xmlFormat.ts';
import type { WriteIssue, WriteResult } from './bpmnWrite.ts';
import { errorListSource, parseErrorList } from './errorCodes.ts';

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
/**
 * `correlationKeys`: der am Schritt gewählte Korrelationsschlüssel je Element-ID —
 * eine wartende Nachricht ohne bekommt in Camunda 8 den Vorschlag `=businessKey`.
 */
export function convertBpmn(xml: string, target: EngineId, opts: { timeToLive?: string; correlationKeys?: Record<string, string> } = {}): WriteResult & { changed: boolean } {
  const issues: WriteIssue[] = [];
  if (detectEngine(xml) === target) return { xml, issues, changed: false };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const defs = doc.documentElement;
  if (!defs || local(defs) !== 'definitions' || doc.getElementsByTagName('parsererror').length) {
    return { xml, changed: false, issues: [{ stepId: '', where: 'BPMN', text: 'Das Diagramm ist kein lesbares BPMN — nichts umgewandelt.' }] };
  }
  const bpmnPrefix = defs.prefix ? `${defs.prefix}:` : '';
  const ctx: Ctx = {
    doc, issues, later: [], correlationKeys: opts.correlationKeys ?? {},
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
  /** Element-ID → gewählter Korrelationsschlüssel (siehe convertBpmn) */
  correlationKeys: Record<string, string>;
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
  const setEvents: SetEvent[] = [];

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
      if (cattr(el, a)) issue('Implementierung', `camunda:${a}="${cattr(el, a)}" — in ${C8_LABEL} als Job-Worker (zeebe:taskDefinition) umsetzen.`);
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
    //    Muster an End-Events: `execution.setVariable("processStatus", "…")`) —
    //    am Element oder an einem None-Throw-Event davor/danach (placementOf)
    const cio = ext0 ? firstNamed(ext0, 'inputOutput', CAMUNDA_NS) : null;
    // nur Ausgaben, die ein zeebe:output werden (complexParam: ein Skript, eine Liste, eine Map nicht)
    const hasOutputs = io.some(p => local(p) === 'output')
      || (!!cio && kids(cio).some(p => local(p) === 'outputParameter' && !complexParam(p)));
    const listeners = ext0 ? kids(ext0).filter(k => inNs(k, CAMUNDA_NS) && local(k) === 'executionListener') : [];
    // nach den eigenen Ausgaben — in Camunda 7 lief der end-Listener nach dem Output-Mapping
    const listenerOutputs: Element[] = [];
    for (const l of listeners) {
      const sv = setVariableOf(l.getAttribute('expression') ?? '');
      if (!sv) continue;
      const event = l.getAttribute('event') ?? 'start';
      const place = placementOf(el, event, hasOutputs);
      if (!place) {
        issue('Listener', `setVariable «${sv.name}» NICHT übernommen — Listener-Event «${event}» hier unbekannt: von Hand umsetzen.`);
        keepAsComment(el, [listenerText(l)]);
        removeEl(l);
        continue;
      }
      const output = zeebe('output', { source: toFeelSource(`\${${sv.value}}`, `Ausgabe «${sv.name}»`, issue), target: sv.name });
      if (place === 'here') listenerOutputs.push(output);
      else {
        const known = setEvents.find(x => x.el === el && x.place === place);
        if (known) { known.outputs.push(output); known.listeners.push(listenerText(l)); }
        else setEvents.push({ el, place, outputs: [output], listeners: [listenerText(l)] });
      }
      removeEl(l);
    }

    // ── lokale Variablen: inputOutput → ioMapping
    if (cio) {
      for (const p of kids(cio)) {
        const tag = local(p) === 'inputParameter' ? 'input' : 'output';
        const target = p.getAttribute('name') ?? '';
        const where = `${tag === 'input' ? 'Eingabe' : 'Ausgabe'} «${target}»`;
        const complex = complexParam(p);
        if (complex) {
          issue(where, local(complex) === 'script'
            ? `ist ein Skript — in ${C8_LABEL} als FEEL-Ausdruck neu schreiben.`
            : `ist eine ${local(complex) === 'list' ? 'Liste' : 'Map'} — als FEEL-Ausdruck neu schreiben.`);
          continue;
        }
        if (tag === 'input' && ERROR_LISTS.has(target)) { io.push(zeebe(tag, { source: errorListSource(parseErrorList(p.textContent ?? ''), 'c8'), target })); continue; }
        io.push(zeebe(tag, { source: toFeelSource(p.textContent ?? '', where, issue), target }));
      }
    }
    io.push(...listenerOutputs);
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
      if (!result) issue('Entscheidung', `${C8_LABEL} braucht eine resultVariable — ergänzen.`);
      add.push(zeebe('calledDecision', { decisionId: decision, resultVariable: result || undefined }));
      issue('Entscheidung', `Ergebnisform prüfen: ${C8_LABEL} liefert je nach Hit Policy einen Wert, einen Context oder eine Liste (${C7_LABEL} immer eine Liste).`);
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
      issue('Formular', `formKey «${formKey}» — in ${C8_LABEL} als Formular (externe Referenz) prüfen.`);
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
      if (firstNamed(el, 'loopCardinality')) issue('Mehrfachausführung', `loopCardinality gibt es in ${C8_LABEL} nicht — über eine Sammlung lösen.`);
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
          const chosen = ctx.correlationKeys[holder.getAttribute('id') ?? ''];
          appendEl(mext, zeebe('subscription', { correlationKey: chosen ?? '=businessKey' }));
          if (!chosen) issueAt(ctx, holder)('Nachricht', `«${msg.getAttribute('name') ?? ref}» — Korrelationsschlüssel «=businessKey» vorgeschlagen, prüfen.`);
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
              ? `camunda:${n} entfernt — in ${C8_LABEL} als Job-Worker-Listener oder Output-Mapping umsetzen.`
              : `camunda:${n} entfernt — hat in ${C8_LABEL} kein Gegenstück.`);
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
      if (!handled.includes(n) && !C7_ONLY.has(n)) issue('Erweiterung', `camunda:${n}="${a.value}" entfernt — hat in ${C8_LABEL} kein Gegenstück.`);
      el.removeAttributeNode(a);
    }
    if (name === 'scriptTask') issue('Skript', `Skript-Aufgabe — in ${C8_LABEL} als FEEL (zeebe:script) oder Job-Worker umsetzen.`);

    if (add.length) {
      const ext = extOf(ctx, el);
      fill(ext, add);
    }
    touched.push(el);
  }

  for (const [parent, children] of ctx.later) fill(parent, children);
  for (const el of touched) dropEmptyExt(el);
  if (setEvents.length) {
    // einmal für alle Events: die vergebenen Ids und das Diagramm
    const ids = new Set(descendants(defs).map(e => e.getAttribute('id')).filter(Boolean));
    const uniqueId = (base: string) => { let n = base; for (let i = 2; ids.has(n); i++) n = `${base}_${i}`; ids.add(n); return n; };
    const di = diagramOf(defs);
    // die take-Listener zuerst: so steht ihr Event hinter dem eines end-Listeners an der Quelle
    // (Camunda 7: erst end, dann take, dann start am Ziel)
    const ordered = [...setEvents.filter(e => e.place === 'on'), ...setEvents.filter(e => e.place !== 'on')];
    for (const e of ordered) insertSetEvent(ctx, e, uniqueId, di);
  }
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

// ── Listener → None-Throw-Event ──────────────────────────────────────────────
//
// Ein Output-Mapping greift beim Abschluss des Elements: an einem None-/Link-
// Event sofort, an anderen erst, wenn sie fertig sind — der Listener setzte die
// Variable aber beim Betreten. An Gateways und End-Events mit Definition nimmt
// Zeebe es an und ignoriert es (am Cluster geprüft: Event-Based Gateway, Error-
// End-Event). Und ein erstes Output-Mapping an einer Aufgabe nähme ihr die
// übrigen Ergebnisse (nur noch die gemappten gehen in den Prozess). Dort setzt
// ein None-Throw-Event davor oder danach die Variable — sichtbar im Diagramm.

/** `on`: auf dem Fluss selbst (ein take-Listener an einem Sequenzfluss) */
type Placement = 'here' | 'before' | 'after' | 'on';

/** wo ein eigenes Event die Variable setzt */
type EventPlacement = Exclude<Placement, 'here'>;

/** `listeners`: die Camunda-7-Listener, als Text — bleibt einer ohne Event, steht er als Kommentar am Element */
interface SetEvent { el: Element; place: EventPlacement; outputs: Element[]; listeners: string[] }

const listenerText = (l: Element) => `camunda:executionListener event="${l.getAttribute('event') ?? 'start'}" expression="${l.getAttribute('expression') ?? ''}"`;

/** Was nicht übernommen wurde, bleibt als Kommentar am Element — für die Handarbeit */
function keepAsComment(el: Element, listeners: string[], flows: string[] = []) {
  const where = flows.length ? ` auf ${flows.map(f => `«${f}»`).join(', ')}` : '';
  for (const text of listeners) {
    // `--` darf in einem XML-Kommentar nicht stehen
    prependEl(el, el.ownerDocument.createComment(` ${C7_LABEL}, nicht übernommen${where}: ${text.replace(/--/g, '- -')} `) as unknown as Element);
  }
}

/** wie das Event ins Diagramm kam */
type Drawn = 'ok' | 'tight' | 'short' | 'none';

/** Zwischen-Ereignisse — ohne Definition oder als Link schliessen sie ab, sobald sie eintreten */
const INTERMEDIATE_EVENTS = new Set(['intermediateThrowEvent', 'intermediateCatchEvent']);

function placementOf(el: Element, event: string, hasOutputs: boolean): Placement | null {
  const name = local(el);
  if (name === 'sequenceFlow') return event === 'take' ? 'on' : null;
  if (event !== 'start' && event !== 'end') return null;
  const definitions = kids(el).map(local).filter(n => n.endsWith('EventDefinition'));
  if (name === 'startEvent' || name === 'boundaryEvent') return 'here';
  if (name === 'endEvent' && !definitions.length) return 'here';
  if (INTERMEDIATE_EVENTS.has(name) && definitions.every(d => d === 'linkEventDefinition')) return 'here';
  if (name === 'endEvent' || event === 'start') return 'before';
  // ein paralleler Fork verzweigt sofort: ein Event davor statt eines je Zweig (gleichzeitig)
  if (name === 'parallelGateway' && incomingOf(el).length === 1) return 'before';
  // ein Gateway hat nie ein wirksames Output-Mapping, auch mit Ausgaben nicht
  if (name.endsWith('Gateway')) return 'after';
  return hasOutputs ? 'here' : 'after';
}

const incomingOf = (el: Element) => (el.parentElement ? kids(el.parentElement) : [])
  .filter(k => local(k) === 'sequenceFlow' && k.getAttribute('targetRef') === el.getAttribute('id'));

function setEventReason(el: Element, place: EventPlacement): string {
  const name = local(el);
  if (place === 'on') return 'der take-Listener lief beim Durchlaufen des Flusses';
  if (name.endsWith('Gateway') || name === 'endEvent') return `ein Output-Mapping am ${name} ignoriert ${C8_LABEL}`;
  return place === 'before'
    ? 'ein Output-Mapping griffe erst beim Abschluss, der Listener setzte die Variable beim Betreten'
    : 'ein erstes Output-Mapping nähme dem Element seine übrigen Ergebnisse';
}

/** Ein None-Throw-Event mit den Output-Mappings auf jedem Fluss davor bzw. danach —
 *  je Fluss eines, so wartet ein Join-Gateway weiter auf alle Zweige. */
function insertSetEvent(ctx: Ctx, { el, place, outputs, listeners }: SetEvent, uniqueId: (base: string) => string, di: Diagram | null) {
  const id = el.getAttribute('id') ?? '';
  const parent = el.parentElement;
  const issue = issueAt(ctx, el);
  const names = outputs.map(o => o.getAttribute('target')).join(', ');
  const side = place === 'before' ? 'davor' : place === 'after' ? 'danach' : 'auf dem Fluss';
  const flowsOf = (p: Element) => place === 'on' ? [el]
    : kids(p).filter(k => local(k) === 'sequenceFlow' && k.getAttribute(place === 'before' ? 'targetRef' : 'sourceRef') === id);
  const flows = parent ? flowsOf(parent) : [];
  if (!parent || !flows.length) {
    issue('Listener', `setVariable «${names}» NICHT übernommen — ${setEventReason(el, place)}, und es gibt keinen Fluss ${side}: von Hand umsetzen.`);
    keepAsComment(el, listeners);
    return;
  }
  const sourceOf = (flow: Element) => kids(parent).find(k => k.getAttribute('id') === flow.getAttribute('sourceRef'));
  // was anders läuft als der Listener — im Dialog sagen
  const hints = [
    // ein Listener je Instanz wird ein Event für die ganze Mehrfachausführung
    firstNamed(el, 'multiInstanceLoopCharacteristics') ? 'Mehrfachausführung: das Event läuft einmal, der Listener lief je Instanz — prüfen.' : '',
    flows.length > 1 ? `Ein Event je Fluss: die Variable wird bis zu ${flows.length}-mal gesetzt${
      // mehr als ein Fluss ohne Bedingung (ausser am exklusiven Gateway): sie laufen parallel
      place === 'after' && local(el) !== 'exclusiveGateway' && flows.filter(f => !firstNamed(f, 'conditionExpression')).length > 1
        ? ', auf parallelen Zweigen gleichzeitig' : ''
    } — bei einem nicht festen Wert (Zähler, Zeit) prüfen.` : '',
  ].filter(Boolean).map(h => ` ${h}`).join('');
  // eine eigene Meldung: an diesem Weg fehlt die Variable
  const interrupted = place === 'after' ? interruptedBy(parent, id) : '';
  if (interrupted) issue('Listener', `setVariable «${names}» fehlt bei ${interrupted}`);
  let first = true;
  const skipped: string[] = [];
  for (const flow of flows) {
    const source = sourceOf(flow);
    if (!source) {
      issue('Listener', `setVariable «${names}» NICHT übernommen auf «${flow.getAttribute('id')}» — die Quelle des Flusses fehlt: von Hand umsetzen.`);
      skipped.push(flow.getAttribute('id') ?? '');
      continue;
    }
    if (local(source) === 'eventBasedGateway') {
      // nach einem Event-Based Gateway darf nur ein Catch-Event folgen
      issue('Listener', `setVariable «${names}» NICHT übernommen auf «${flow.getAttribute('id')}» — nach einem Event-Based Gateway darf nur ein Catch-Event stehen: von Hand umsetzen (z. B. als Output-Mapping am Catch-Event).`);
      skipped.push(flow.getAttribute('id') ?? '');
      continue;
    }
    const evId = uniqueId(`${id}_Set${place === 'before' ? 'Before' : place === 'after' ? 'After' : ''}`);
    const nfId = uniqueId(`${evId}_Flow`);
    insertOnFlow(ctx, parent, flow, evId, nfId, `set ${names}`, first ? outputs : outputs.map(o => o.cloneNode(true) as Element));
    first = false;
    const drawn: Drawn = di?.place(evId, nfId, flow.getAttribute('id') ?? '', place === 'before', uniqueId) ?? 'none';
    issue('Listener', `setVariable «${names}» — None-Throw-Event «set ${names}» ${side} eingefügt: ${setEventReason(el, place)}.${hints} ${DRAWN_TEXT[drawn]}`);
  }
  // alle ausgelassen: der Listener ist nicht übernommen, sonst nur auf diesen Flüssen
  if (skipped.length) keepAsComment(el, listeners, skipped.length < flows.length ? skipped : []);
}

const DRAWN_TEXT: Record<Drawn, string> = {
  ok: 'Lage im Diagramm prüfen.',
  tight: 'Lage im Diagramm prüfen (wenig Platz auf dem Fluss).',
  short: 'Ohne Diagramm-Eintrag (zu wenig Platz auf dem Fluss) — im Modeler einzeichnen.',
  none: 'Ohne Diagramm-Eintrag (dem Fluss fehlt die Kante) — im Modeler einzeichnen.',
};

/** Ein unterbrechendes Boundary-Event (auch ein Fehler): dann lief der end-Listener auch, das Event danach nicht */
function interruptedBy(parent: Element, id: string): string {
  const boundaries = kids(parent).filter(k => local(k) === 'boundaryEvent' && k.getAttribute('attachedToRef') === id
    && k.getAttribute('cancelActivity') !== 'false');
  return boundaries.length
    ? `Abbruch oder Fehler über ${boundaries.map(b => `«${b.getAttribute('name') || b.getAttribute('id')}»`).join(', ')}: dort lief der Listener auch, das Event nicht — dort ergänzen.`
    : '';
}

/** Das Event auf den Fluss setzen: der Fluss (mit seiner Bedingung) endet am
 *  Event, ein neuer führt zum bisherigen Ziel. */
function insertOnFlow(ctx: Ctx, parent: Element, flow: Element, evId: string, nfId: string, name: string, outputs: Element[]) {
  const ref = (tag: 'incoming' | 'outgoing', text: string) => { const r = ctx.bpmnEl(tag); r.textContent = text; return r; };
  const flowId = flow.getAttribute('id') ?? '';
  const targetId = flow.getAttribute('targetRef') ?? '';
  const target = kids(parent).find(k => k.getAttribute('id') === targetId);
  const ev = ctx.bpmnEl('intermediateThrowEvent');
  ev.setAttribute('id', evId);
  ev.setAttribute('name', name);
  const nf = ctx.bpmnEl('sequenceFlow');
  nf.setAttribute('id', nfId);
  nf.setAttribute('sourceRef', evId);
  nf.setAttribute('targetRef', targetId);
  flow.setAttribute('targetRef', evId);
  const old = target && kids(target).find(k => local(k) === 'incoming' && k.textContent?.trim() === flowId);
  if (old) removeEl(old);
  if (target) appendEl(target, ref('incoming', nfId));
  appendEl(parent, ev);
  appendEl(parent, nf);
  const ext = ctx.bpmnEl('extensionElements');
  appendEl(ev, ext);
  const io = create(ctx, ZEEBE_NS, 'zeebe', 'ioMapping');
  appendEl(ext, io);
  fill(io, outputs);
  appendEl(ev, ref('incoming', flowId));
  appendEl(ev, ref('outgoing', nfId));
}

interface Point { x: number; y: number }

/** Grösse eines Events im Diagramm (Breite = Höhe) — und die Luft, ab der es nicht eng ist */
const EVENT_SIZE = 36;
const EVENT_ROOM = EVENT_SIZE + 20;

type Diagram = NonNullable<ReturnType<typeof diagramOf>>;

/** Das Diagramm: Shape und Kante fürs eingefügte Event — auf dem letzten Stück
 *  des Flusses davor bzw. dem ersten des Flusses danach */
function diagramOf(defs: Element) {
  const all = descendants(defs);
  const edges = all.filter(e => local(e) === 'BPMNEdge');
  const shape0 = all.find(e => local(e) === 'BPMNShape');
  const bounds0 = shape0 ? firstNamed(shape0, 'Bounds') : null;
  const wp0 = edges.map(e => firstNamed(e, 'waypoint')).find(Boolean);
  if (!shape0 || !bounds0 || !wp0) return null;
  const doc = defs.ownerDocument;
  const make = (like: Element, name: string, attrs: Record<string, string | number>) => {
    const prefix = like.prefix ?? (like.tagName.includes(':') ? like.tagName.split(':')[0] : '');
    const e = doc.createElementNS(like.namespaceURI, prefix ? `${prefix}:${name}` : name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const pointsOf = (edge: Element): Point[] =>
    // parseFloat: ein fehlender Wert ist NaN (Number(null) wäre 0)
    kids(edge).filter(k => local(k) === 'waypoint').map(w => ({ x: parseFloat(w.getAttribute('x') ?? ''), y: parseFloat(w.getAttribute('y') ?? '') }));
  const setPoints = (edge: Element, points: Point[]) => {
    // die Wegpunkte vor dem Label — so will es das Schema (waypoint*, BPMNLabel?)
    const rest = kids(edge).filter(k => local(k) !== 'waypoint');
    for (const k of kids(edge)) removeEl(k);
    for (const p of points) appendEl(edge, make(wp0, 'waypoint', { x: Math.round(p.x), y: Math.round(p.y) }));
    for (const k of rest) appendEl(edge, k);
  };
  return {
    /** `none`: keine (brauchbare) Kante, `short`: das Stück ist kürzer als das Event —
     *  beide ohne Diagramm-Eintrag; `tight`: kaum Luft neben dem Event */
    place(evId: string, nfId: string, flowId: string, atEnd: boolean, uniqueId: (base: string) => string): Drawn {
      const flowEdge = edges.find(e => e.getAttribute('bpmnElement') === flowId);
      const points = flowEdge ? pointsOf(flowEdge) : [];
      const plane = flowEdge?.parentElement;
      if (!flowEdge || !plane || points.length < 2) return 'none';
      const at = atEnd ? points.length - 2 : 0;
      const [a, b] = [points[at], points[at + 1]];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // ein Wegpunkt ohne Koordinate: nichts zeichnen statt NaN
      if (!Number.isFinite(len)) return 'none';
      // kürzer als das Event: die gekürzten Kanten liefen rückwärts
      if (len < EVENT_SIZE) return 'short';
      const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const shape = make(shape0, 'BPMNShape', { id: uniqueId(`${evId}_di`), bpmnElement: evId });
      appendEl(plane, shape);
      const r = EVENT_SIZE / 2;
      appendEl(shape, make(bounds0, 'Bounds', { x: Math.round(c.x - r), y: Math.round(c.y - r), width: EVENT_SIZE, height: EVENT_SIZE }));
      const edge = make(flowEdge, 'BPMNEdge', { id: uniqueId(`${nfId}_di`), bpmnElement: nfId });
      appendEl(plane, edge);
      edges.push(edge); // ein weiteres Event kann auf dem neuen Fluss landen
      // die Kante des Flusses endet am Event, die neue führt weiter auf dem alten Weg
      setPoints(flowEdge, [...points.slice(0, at + 1), { x: c.x - d.x * r, y: c.y - d.y * r }]);
      setPoints(edge, [{ x: c.x + d.x * r, y: c.y + d.y * r }, ...points.slice(at + 1)]);
      return len < EVENT_ROOM ? 'tight' : 'ok';
    },
  };
}

/** Ein Parameter mit Skript, Liste oder Map — wird kein zeebe:input/output */
const complexParam = (p: Element): Element | undefined => kids(p).find(k => ['script', 'list', 'map'].includes(local(k)));

/** `${execution.setVariable("x", v)}` → { name: x, value: v } */
function setVariableOf(expression: string): { name: string; value: string } | null {
  const m = /^[$#]\{\s*execution\.setVariable\(\s*(["'])([^"']+)\1\s*,\s*([\s\S]+?)\s*\)\s*\}$/.exec(expression.trim());
  return m ? { name: m[2], value: m[3] } : null;
}

function toJuelAttr(v: string | null, where: string, issue: Issue): string | undefined {
  if (!v) return undefined;
  return v.trim().startsWith('=') ? toJuel(v, where, issue) : v;
}
