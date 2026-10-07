// Exporte — derselbe Baum, drei Zielgruppen.
//
//  · fachlich    für Stakeholder: nur Ablauf, Beschreibungen, offene Punkte
//  · orchescala  für die Umsetzung (und für KI): Topics, Services, Mappings,
//                Fehler, Mocks — vollständig und eindeutig
//  · json        die Spezifikation selbst (Sicherung / Weiterverarbeitung)

import { overallStatus } from './status.ts';
import type { AppliedPattern, Branch, EngineId, ErrorHandling, Mapping, Model, ProcessSpec, ServiceDef, Status, Step } from './types.ts';
import { STATUS_META } from './types.ts';
import { blockGroups, blockStart, statusCounts } from './bpmn.ts';
import { scalaBundle } from './scala.ts';
import { engineLabel } from './template.ts';
import { processTarget, stepTarget, threadsUnder, typeTarget } from './comments.ts';
import { writeBpmn, type WriteResult } from './bpmnWrite.ts';
import { convertBpmn } from './engineConvert.ts';
import { engineExpression } from './feelJuel.ts';
import { gzipSync, strToU8 } from 'fflate';
import { splitPrefix } from './stepIds.ts';
import { epicsOf } from './epics.ts';

export type ExportKind = 'fachlich' | 'orchescala' | 'scala' | 'bpmn' | 'json';

export const EXPORT_META: Record<ExportKind, { label: string; hint: string; ext: string }> = {
  fachlich: {
    label: 'Fachlich',
    hint: 'Ablauf in Prosa — für Fachbereich, Review und Abnahme. Ohne technische Ausdrücke.',
    ext: 'md',
  },
  orchescala: {
    label: 'Orchescala',
    hint: 'Vollständig und eindeutig: Topics, Services, Mappings, Fehler, Mocks — die Vorlage für die Implementierung.',
    ext: 'md',
  },
  bpmn: {
    label: 'BPMN',
    hint: 'Das Diagramm mit den Mappings und Bedingungen aus der Spezifikation — FEEL für Camunda 8 wie es ist, für Camunda 7 nach JUEL übersetzt.',
    ext: 'bpmn',
  },
  scala: {
    label: 'Scala',
    hint: 'Das Datenmodell als Orchescala-Domain — case class, Companion mit ApiSchema/InOutCodec und example. Ohne InConfig/InitIn (Implementations-Details).',
    ext: 'scala',
  },
  json: {
    label: 'JSON',
    hint: 'Die Spezifikation als Datei — Sicherung oder Weiterverarbeitung.',
    ext: 'json',
  },
};

const KIND_LABEL: Record<string, string> = {
  start: 'Start', end: 'Ende', service: 'Service', user: 'Benutzeraufgabe', call: 'Teilprozess',
  send: 'Senden', receive: 'Empfangen', rule: 'Entscheidungstabelle', script: 'Skript',
  manual: 'Manuell', subprocess: 'Subprozess', gateway: 'Verzweigung', event: 'Ereignis',
  goto: 'Verweis',
};

const bullet = (depth: number) => '  '.repeat(depth) + '-';

function statusTag(s: Status): string {
  return `[${STATUS_META[s].label}]`;
}

// ── Pattern ──────────────────────────────────────────────────────────────────
// Ein Pattern steht als **ein** Eintrag am Schritt — Name und Werte. Was es
// ins Diagramm bringt (Timer, Link, gemeinsamer Block), ist Verdrahtung und
// erscheint nicht als eigene Schritte: fachlich gar nicht, im
// Orchescala-Export im Überblick markiert.
type PatternNames = (id: string) => string;
const patternNames = (model: Model | null): PatternNames => id => model?.patterns?.find(p => p.id === id)?.name ?? id;
function patternText(ps: AppliedPattern[] | undefined, name: PatternNames, code = false): string {
  return (ps ?? []).map(p => {
    const werte = Object.entries(p.params ?? {}).filter(([, v]) => v !== '').map(([k, v]) => (code ? `${k} = \`${v}\`` : `${k} = ${v}`));
    return `${name(p.id)}${werte.length ? ` (${werte.join(', ')})` : ''}`;
  }).join(' · ');
}

// ── Fachlicher Export ────────────────────────────────────────────────────────
/**
 * Die Schritte einer Ebene — eigene Blöcke (zweiter Start, Link-Ziel) in
 * einer Klammer wie im Baum: eine Überschrift, die Schritte darunter eine
 * Stufe eingerückt. Ein Ereignis-Subprozess steht als solcher da.
 */
function fachlichSteps(spec: ProcessSpec, steps: Step[], depth: number, out: string[], pn: PatternNames) {
  for (const g of blockGroups(steps)) {
    if (!g.head) { fachlichStepsFlat(spec, g.steps, depth, out, pn); continue; }
    // der gemeinsame Block eines Patterns ist Verdrahtung — er steht beim Pattern am Schritt
    if (g.head.pattern) continue;
    out.push(`${bullet(depth)} *Eigener Block — ${blockStart(g.head)}*`);
    fachlichStepsFlat(spec, g.steps, depth + 1, out, pn);
  }
}

function fachlichStepsFlat(spec: ProcessSpec, steps: Step[], depth: number, out: string[], pn: PatternNames) {
  for (const s of steps) {
    if (s.kind === 'goto') {
      out.push(`${bullet(depth)} ${s.back ? '↻ zurück zu' : '→ weiter bei'} «${s.name}»`);
      continue;
    }
    const loop = s.loop ? ` — wiederholt${s.loop.condition && s.loop.condition !== 'Wiederholung' ? `, solange: ${s.loop.condition}` : ''}` : '';
    const ereignis = s.eventSubprocess ? ' — Ereignis-Subprozess, läuft neben dem Hauptablauf' : '';
    out.push(`${bullet(depth)} **${s.name}** ${statusTag(s.status)}${loop}${ereignis}`);
    if (s.description) {
      for (const line of s.description.split('\n')) out.push(`${'  '.repeat(depth + 1)}${line}`);
    }
    if (s.candidateGroups || s.candidateUsers || s.assignee) {
      out.push(`${'  '.repeat(depth + 1)}Zuständig: ${[s.candidateGroups, s.candidateUsers, s.assignee].filter(Boolean).join(' · ')}`);
    }
    if (s.patterns?.length) out.push(`${'  '.repeat(depth + 1)}Pattern: ${patternText(s.patterns, pn)}`);
    out.push(...kommentarZeilen(spec, stepTarget(s.id), '  '.repeat(depth + 1)));
    for (const b of s.branches ?? []) {
      out.push(`${bullet(depth + 1)} *${b.label}*`);
      fachlichSteps(spec, b.steps, depth + 2, out, pn);
    }
    for (const e of s.errors ?? []) {
      if (!e.steps?.length || e.pattern) continue;
      out.push(`${bullet(depth + 1)} *${e.side ? 'Nebenpfad' : 'Fehlerfall'} «${e.code}»*`);
      fachlichSteps(spec, e.steps, depth + 2, out, pn);
    }
    if (s.children?.length) fachlichSteps(spec, s.children, depth + 1, out, pn);
  }
}

const openThreads = (spec: ProcessSpec, target: string) =>
  threadsUnder(spec, target).filter(t => !t.resolved).length;

/**
 * Offene Kommentar-Fäden zu einem Element samt seiner Teile, als Zeilen —
 * ein Teil (Mapping-Zeile, Feld …) steht in Klammern davor.
 */
function kommentarZeilen(spec: ProcessSpec, target: string, einzug: string): string[] {
  const out: string[] = [];
  for (const faden of threadsUnder(spec, target).filter(t => !t.resolved)) {
    const teil = faden.target.includes('#') ? `(${faden.target.slice(faden.target.indexOf('#') + 1)}) ` : '';
    for (const [i, e] of faden.entries.entries()) {
      out.push(`${einzug}${i ? '  ↳ ' : `💬 ${teil}`}${e.author}: ${e.text.replace(/\n+/g, ' ')}`);
    }
  }
  return out;
}

function exportFachlich(spec: ProcessSpec, model: Model | null): string {
  const pn = patternNames(model);
  const counts = statusCounts(spec);
  const out: string[] = [
    `# ${spec.title}`,
    '',
    `Status: **${STATUS_META[overallStatus(spec)].label}** · Stand ${spec.updatedAt.slice(0, 10)}`,
    '',
  ];
  if (spec.description) out.push(spec.description, '');
  if (spec.timeToLive) out.push(`Historie wird ${spec.timeToLive} Tage aufbewahrt.`, '');
  if (spec.patterns?.length) out.push(`Pattern am Prozess: ${patternText(spec.patterns, pn)}`, '');
  const epics = epicsOf(spec, model);
  if (epics.length) out.push(`Epics: ${epics.map(e => e.name).join(', ')}`, '');
  const amProzess = kommentarZeilen(spec, processTarget, '');
  if (amProzess.length) out.push('### Offene Kommentare zum Prozess', '', ...amProzess, '');
  out.push('## Ablauf', '');
  fachlichSteps(spec, spec.steps, 0, out, pn);

  out.push('', '---', '',
    `Schritte: ${Object.values(counts).reduce((a, b) => a + b, 0)} — ` +
    Object.entries(counts).filter(([, n]) => n > 0)
      .map(([k, n]) => `${STATUS_META[k as Status].label} ${n}`).join(' · '));
  return out.join('\n');
}

// ── Orchescala-Export ────────────────────────────────────────────────────────
// Bewusst flach und explizit: jeder Schritt bekommt einen Abschnitt mit
// stabiler ID, damit eine KI daraus direkt Worker, Domain und Simulation
// ableiten kann, ohne im Baum navigieren zu müssen. Der Baum steht davor
// als Überblick.
function outline(steps: Step[], depth: number, out: string[]) {
  for (const g of blockGroups(steps)) {
    if (!g.head) { outlineFlat(g.steps, depth, out); continue; }
    out.push(`${bullet(depth)} [${g.head.pattern ? `Pattern ${g.head.pattern}, gemeinsamer Block` : 'Eigener Block'} — ${blockStart(g.head)}]`);
    outlineFlat(g.steps, depth + 1, out);
  }
}

function outlineFlat(steps: Step[], depth: number, out: string[]) {
  for (const s of steps) {
    if (s.kind === 'goto') {
      out.push(`${bullet(depth)} ${s.back ? '↻' : '→'} \`${s.gotoId}\``);
      continue;
    }
    const marks = [
      s.loop ? '↻' : '',
      s.errors?.length ? '⚠' : '',
      s.eventSubprocess ? '[Ereignis-Subprozess]' : '',
      ...(s.patterns ?? []).map(p => `[Pattern ${p.id}]`),
    ].filter(Boolean).join(' ');
    out.push(`${bullet(depth)} \`${s.id}\` · ${KIND_LABEL[s.kind]} · ${s.name}${marks ? ` ${marks}` : ''}`);
    for (const b of s.branches ?? []) {
      out.push(`${bullet(depth + 1)} [${b.label}]`);
      outline(b.steps, depth + 2, out);
    }
    for (const e of s.errors ?? []) {
      if (!e.steps?.length) continue;
      out.push(`${bullet(depth + 1)} [${e.pattern ? `Pattern ${e.pattern}: ` : ''}${e.side ? 'Nebenpfad' : 'Fehler'} ${e.code}]`);
      outline(e.steps, depth + 2, out);
    }
    if (s.children?.length) outline(s.children, depth + 1, out);
  }
}

function flatten(steps: Step[], parent: string | null, out: Array<{ step: Step; parent: string | null }> = []) {
  for (const s of steps) {
    if (s.kind === 'goto') continue;
    out.push({ step: s, parent });
    flatten(s.children ?? [], s.id, out);
    for (const b of s.branches ?? []) flatten(b.steps, s.id, out);
    for (const e of s.errors ?? []) flatten(e.steps ?? [], s.id, out);
  }
  return out;
}

function table(rows: string[][], head: string[]): string[] {
  if (!rows.length) return [];
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${r.map(c => (c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`),
    '',
  ];
}

function exportOrchescala(spec: ProcessSpec, model: Model | null): string {
  const pn = patternNames(model);
  const byId = new Map((model?.services ?? []).map(s => [s.id, s] as [string, ServiceDef]));
  // Ausdrücke so, wie die Engine sie braucht: FEEL bleibt für Camunda 8,
  // wird für Camunda 7 zu JUEL — was sich nicht übersetzen lässt, steht
  // markiert als FEEL da, mit dem Grund.
  const ausdruck = (e: string): string => {
    const r = engineExpression(e, spec.engine);
    return r.issue ? `\`${r.text}\` ⚠ *FEEL, nicht nach JUEL übersetzbar: ${r.issue}*` : `\`${r.text}\``;
  };
  const out: string[] = [
    `# ${spec.name} — Orchescala-Spezifikation`,
    '',
    ...table([
      ['Prozess-ID', `\`${spec.processId ?? ''}\``],
      ['Projekt', `\`${spec.project ?? ''}\``],
      ['Titel', spec.title],
      ['Status', STATUS_META[overallStatus(spec)].label],
      ['Engine', engineLabel(spec.engine)],
      ['Stand', spec.updatedAt],
      ...(spec.timeToLive ? [['Time to Live', `${spec.timeToLive} Tage`]] : []),
      ...(spec.sourceUrl ? [['Quelle', spec.sourceUrl]] : []),
      ...(epicsOf(spec, model).length ? [['Epics', epicsOf(spec, model).map(e => e.name).join(', ')]] : []),
      ...(spec.patterns?.length ? [['Pattern', patternText(spec.patterns, pn, true)]] : []),
    ], ['Feld', 'Wert']),
  ];
  if (spec.description) out.push('## Ausgangslage', '', spec.description, '');

  if (spec.variables?.length) {
    out.push('## Prozessvariablen', '');
    out.push(...table(spec.variables.map(v => [`\`${v.name}\``, v.type ?? '', v.description ?? '', v.example ?? '']),
      ['Name', 'Typ', 'Bedeutung', 'Beispiel']));
  }

  if (spec.types?.length) {
    out.push('## Datenmodell', '');
    out.push('```scala', scalaBundle(spec, model), '```', '');
    // Offene Fragen am Datentyp gehören zum Datenmodell, nicht ans Ende
    for (const t of spec.types) {
      const zeilen = kommentarZeilen(spec, typeTarget(t.id), '');
      if (zeilen.length) out.push(`**Offen zu \`${t.name}\`**`, '', ...zeilen, '');
    }
  }

  const amProzess = kommentarZeilen(spec, processTarget, '');
  if (amProzess.length) out.push('## Offene Kommentare zum Prozess', '', ...amProzess, '');

  out.push('## Ablauf (Überblick)', '');
  outline(spec.steps, 0, out);
  out.push('');

  out.push('## Schritte', '');
  for (const { step: s, parent } of flatten(spec.steps, null)) {
    out.push(`### \`${s.id}\` — ${s.name}`, '');
    const meta: string[][] = [
      ['Art', KIND_LABEL[s.kind] + (s.gatewayType ? ` (${s.gatewayType})` : '')],
      ['Status', STATUS_META[s.status].label],
    ];
    if (parent) meta.push(['Innerhalb von', `\`${parent}\``]);
    if (s.serviceId) {
      const svc = byId.get(s.serviceId);
      meta.push(['Service', `\`${s.serviceId}\`${svc ? ` — ${svc.name}` : ''}`]);
      if (svc?.topic) meta.push(['Topic', `\`${svc.topic}\``]);
    }
    if (s.topic && !byId.get(s.serviceId ?? '')?.topic) meta.push(['Topic', `\`${s.topic}\``]);
    if (s.calledProcess) meta.push(['Ruft Prozess', `\`${s.calledProcess}\``]);
    if (s.eventKind && s.eventKind !== 'none') meta.push(['Ereignis', `${s.eventKind}${s.eventDirection ? ` (${s.eventDirection})` : ''}`]);
    if (openThreads(spec, stepTarget(s.id))) meta.push(['Offene Kommentare', String(openThreads(spec, stepTarget(s.id)))]);
    if (s.candidateGroups) meta.push(['Candidate Groups', `\`${s.candidateGroups}\``]);
    if (s.candidateUsers) meta.push(['Candidate Users', `\`${s.candidateUsers}\``]);
    if (s.assignee) meta.push(['Assignee', `\`${s.assignee}\``]);
    if (s.patterns?.length) meta.push(['Pattern', patternText(s.patterns, pn, true)]);
    if (s.pattern) meta.push(['Gehört zu Pattern', pn(s.pattern)]);
    if (s.loop) {
      meta.push(['Wiederholung', [s.loop.condition, s.loop.maxAttempts && `max ${s.loop.maxAttempts}`, s.loop.waitFor && `warten ${s.loop.waitFor}`]
        .filter(Boolean).join(' · ')]);
    }
    out.push(...table(meta, ['Feld', 'Wert']));

    if (s.description) out.push(s.description, '');
    // Abgewählte Zeilen kommen in diesem Prozess nicht vor — sie stehen nicht
    // im Vertrag, werden aber gezählt, damit klar ist, was der Service könnte.
    const used = (ms: Mapping[] | undefined) => (ms ?? []).filter(m => !m.disabled);
    const off = (ms: Mapping[] | undefined) => (ms ?? []).filter(m => m.disabled);
    if (used(s.inputs).length) {
      out.push('**Eingaben**', '');
      out.push(...table(used(s.inputs).map(i => [`\`${i.name}\``, ausdruck(i.expression), i.description ?? '']), ['Parameter', 'Ausdruck', 'Bedeutung']));
    }
    if (off(s.inputs).length) {
      out.push(`*Nicht verwendet:* ${off(s.inputs).map(i => `\`${i.name}\``).join(', ')}`, '');
    }
    if (used(s.outputs).length) {
      out.push('**Ausgaben**', '');
      out.push(...table(used(s.outputs).map(o => [`\`${o.name}\``, ausdruck(o.expression), o.description ?? '']), ['Variable', 'Ausdruck', 'Bedeutung']));
    }
    if (off(s.outputs).length) {
      out.push(`*Nicht verwendet:* ${off(s.outputs).map(o => `\`${o.name}\``).join(', ')}`, '');
    }
    if (s.errors?.length) {
      out.push('**Fehler und Nebenpfade**', '');
      out.push(...table(s.errors.map((e: ErrorHandling) => [
        `\`${e.code}\``,
        (e.side ? 'Nebenpfad' : e.interrupting === false ? 'Fehler, nicht unterbrechend' : 'Fehler, unterbrechend') + (e.pattern ? ` — Pattern ${pn(e.pattern)}` : ''),
        e.steps?.length ? e.steps.map(x => `\`${x.id}\``).join(' → ') : '',
      ]), ['Fehler', 'Art', 'Behandlung']));
    }
    if (s.branches?.length) {
      out.push('**Zweige**', '');
      out.push(...table(s.branches.map((b: Branch) => [
        b.label, b.condition ? ausdruck(b.condition) : (b.isDefault ? 'Standardzweig' : ''),
        b.steps.filter(x => x.kind !== 'goto').map(x => `\`${x.id}\``).join(' → ') || '(leer)',
      ]), ['Zweig', 'Bedingung', 'Schritte']));
    }
    if (s.mock) out.push('**Mock**', '', '```json', s.mock, '```', '');
    const zeilen = kommentarZeilen(spec, stepTarget(s.id), '');
    if (zeilen.length) out.push('**Offene Kommentare**', '', ...zeilen, '');
  }

  // Pattern: was sie tun und wo die Doku steht — die Vorlage für die Umsetzung
  const verwendet = new Map<string, string[]>();
  for (const p of spec.patterns ?? []) verwendet.set(p.id, [...(verwendet.get(p.id) ?? []), 'Prozess']);
  for (const { step } of flatten(spec.steps, null)) {
    for (const p of step.patterns ?? []) verwendet.set(p.id, [...(verwendet.get(p.id) ?? []), `\`${step.id}\``]);
  }
  if (verwendet.size) {
    out.push('## Verwendete Pattern', '');
    for (const [id, wo] of verwendet) {
      const def = model?.patterns?.find(p => p.id === id);
      out.push(`### ${def?.name ?? id} (\`${id}\`)`, '', `An: ${wo.join(', ')}`, '');
      if (def?.description) out.push(def.description, '');
      if (def?.docUrl) out.push(`Doku: ${def.docUrl}`, '');
    }
  }

  const services = [...new Set(flatten(spec.steps, null).map(f => f.step.serviceId).filter(Boolean))] as string[];
  if (services.length) {
    out.push('## Verwendete Services', '');
    out.push(...table(services.map(id => {
      const svc = byId.get(id);
      return [`\`${id}\``, svc?.name ?? '', svc?.topic ? `\`${svc.topic}\`` : '', svc?.description?.split('\n')[0] ?? ''];
    }), ['Template', 'Name', 'Topic', 'Beschreibung']));
  }
  return out.join('\n');
}

// ── öffentliche API ──────────────────────────────────────────────────────────
/** Das Diagramm mit den Mappings und Bedingungen der Spezifikation — samt dem, was nicht übersetzbar war. */
export function exportBpmn(spec: ProcessSpec, bpmn: string, model: Model | null = null): WriteResult {
  if (!bpmn) return { xml: '<!-- Zu dieser Spezifikation liegt (noch) kein Diagramm vor. -->', issues: [] };
  return writeBpmn(bpmn, spec, model);
}

/**
 * Das Diagramm für eine Engine: die eigene wie es ist, die andere on the fly
 * umgewandelt — die Spezifikation bleibt, wie sie ist. Dasselbe für den
 * BPMN-Export und den Helper-Befehl.
 */
export function exportBpmnFor(spec: ProcessSpec, bpmn: string, engine: EngineId = spec.engine ?? 'c7', model: Model | null = null): WriteResult {
  const written = exportBpmn(spec, bpmn, model);
  if (!bpmn || engine === (spec.engine ?? 'c7')) return written;
  const conv = convertBpmn(written.xml, engine, { timeToLive: spec.timeToLive });
  return { xml: conv.xml, issues: [...written.issues, ...conv.issues] };
}

export function exportSpec(spec: ProcessSpec, kind: ExportKind, model: Model | null, bpmn = ''): string {
  if (kind === 'bpmn') return exportBpmn(spec, bpmn, model).xml;
  if (kind === 'json') return JSON.stringify(spec, null, 2);
  if (kind === 'scala') return scalaBundle(spec, model);
  if (kind === 'fachlich') return exportFachlich(spec, model);
  return exportOrchescala(spec, model);
}

// ── Für den Helper ───────────────────────────────────────────────────────────
/** Eine Tabelle einer DMN Decision für den Helper */
export interface HelperDmn { file: string; xml: string }

/**
 * Der Befehl, der im Projekt den Prozess anlegt — BPMN und Scala-Klassen in
 * **einem** Argument: `orchspec:` + base64url(gzip(JSON)). So braucht der
 * Helper weder Dateien noch eine Anmeldung an SharePoint; `v` erlaubt, das
 * Format später zu ändern (der Helper lehnt eine unbekannte Version ab).
 *
 * Das BPMN ist dasselbe wie im BPMN-Export für die gewählte Engine. Dazu die
 * Tabellen der DMN Decisions (`dmns`: Dateiname im Projekt und XML) — der
 * Helper legt sie neben das BPMN (`src/main/resources/camunda[8]`).
 */
export function helperCommand(spec: ProcessSpec, model: Model | null, bpmn = '', engine?: EngineId, dmns: HelperDmn[] = []): string {
  const payload = JSON.stringify({
    v: 1,
    ...(bpmn ? { bpmn: exportBpmnFor(spec, bpmn, engine, model).xml } : {}),
    scala: scalaBundle(spec, model),
    ...(dmns.length ? { dmns } : {}),
  });
  const zipped = gzipSync(strToU8(payload), { level: 9 });
  let binary = '';
  for (let i = 0; i < zipped.length; i += 0x8000) binary += String.fromCharCode(...zipped.subarray(i, i + 0x8000));
  // base64url ohne «=»: braucht in der Shell keine Anführungszeichen
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `./helper.scala processFromSpec orchspec:${b64}`;
}

/**
 * `projekt-prozessVersion` ohne die Firma, z. B. `savings-openSavingsV1.bpmn`
 * für `globex-savings-openSavingsV1` — aus der aktuellen Prozess-ID, nicht aus
 * dem Slug; ändert sich Projekt oder Version, folgt der Name. Die beiden
 * Markdown-Exporte tragen die Art als Zusatz.
 */
export function exportFileName(spec: ProcessSpec, kind: ExportKind): string {
  const m = /^(.*?)-([A-Za-z][A-Za-z0-9]*V\d+)$/.exec(spec.processId?.trim() ?? '');
  const prefix = m?.[1] ?? spec.project?.trim() ?? '';
  const process = m?.[2] ?? spec.name?.trim();
  const base = [splitPrefix(prefix).project, process].filter(Boolean).join('-') || spec.slug;
  const ext = EXPORT_META[kind].ext;
  return ext === 'md' ? `${base}-${kind}.${ext}` : `${base}.${ext}`;
}
