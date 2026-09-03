// Exporte — derselbe Baum, drei Zielgruppen.
//
//  · fachlich    für Stakeholder: nur Ablauf, Beschreibungen, offene Punkte
//  · orchescala  für die Umsetzung (und für KI): Topics, Services, Mappings,
//                Fehler, Mocks — vollständig und eindeutig
//  · json        die Spezifikation selbst (Sicherung / Weiterverarbeitung)

import type { Branch, ErrorHandling, Mapping, Model, ProcessSpec, ServiceDef, Status, Step } from './types.ts';
import { STATUS_META } from './types.ts';
import { statusCounts } from './bpmn.ts';
import { scalaBundle } from './scala.ts';
import { engineLabel } from './template.ts';
import { processTarget, stepTarget, threadsFor, typeTarget } from './comments.ts';

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
    hint: 'Das Diagramm selbst — Stand aus dem Editor, mit allem, was hier festgelegt wurde.',
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

// ── Fachlicher Export ────────────────────────────────────────────────────────
function fachlichSteps(spec: ProcessSpec, steps: Step[], depth: number, out: string[]) {
  for (const s of steps) {
    if (s.kind === 'goto') {
      out.push(`${bullet(depth)} ${s.back ? '↻ zurück zu' : '→ weiter bei'} «${s.name}»`);
      continue;
    }
    const loop = s.loop ? ` — wiederholt${s.loop.condition && s.loop.condition !== 'Wiederholung' ? `, solange: ${s.loop.condition}` : ''}` : '';
    out.push(`${bullet(depth)} **${s.name}** ${statusTag(s.status)}${loop}`);
    if (s.description) {
      for (const line of s.description.split('\n')) out.push(`${'  '.repeat(depth + 1)}${line}`);
    }
    if (s.candidateGroups || s.assignee) {
      out.push(`${'  '.repeat(depth + 1)}Zuständig: ${[s.candidateGroups, s.assignee].filter(Boolean).join(' · ')}`);
    }
    if (s.open) out.push(`${'  '.repeat(depth + 1)}❓ Offen: ${s.open}`);
    out.push(...kommentarZeilen(spec, stepTarget(s.id), '  '.repeat(depth + 1)));
    for (const b of s.branches ?? []) {
      out.push(`${bullet(depth + 1)} *${b.label}*`);
      fachlichSteps(spec, b.steps, depth + 2, out);
    }
    for (const e of s.errors ?? []) {
      if (!e.steps?.length) continue;
      out.push(`${bullet(depth + 1)} *${e.side ? 'Nebenpfad' : 'Fehlerfall'} «${e.code}»*`);
      fachlichSteps(spec, e.steps, depth + 2, out);
    }
    if (s.children?.length) fachlichSteps(spec, s.children, depth + 1, out);
  }
}

const openThreads = (spec: ProcessSpec, target: string) =>
  threadsFor(spec, target).filter(t => !t.resolved).length;

/** Offene Kommentar-Fäden zu einem Ziel, als Zeilen. */
function kommentarZeilen(spec: ProcessSpec, target: string, einzug: string): string[] {
  const out: string[] = [];
  for (const faden of threadsFor(spec, target).filter(t => !t.resolved)) {
    for (const [i, e] of faden.entries.entries()) {
      out.push(`${einzug}${i ? '  ↳ ' : '💬 '}${e.author}: ${e.text.replace(/\n+/g, ' ')}`);
    }
  }
  return out;
}

function exportFachlich(spec: ProcessSpec): string {
  const counts = statusCounts(spec);
  const out: string[] = [
    `# ${spec.title}`,
    '',
    `Status: **${STATUS_META[spec.status].label}** · Stand ${spec.updatedAt.slice(0, 10)}`,
    '',
  ];
  if (spec.description) out.push(spec.description, '');
  if (spec.timeToLive) out.push(`Historie wird ${spec.timeToLive} Tage aufbewahrt.`, '');
  const amProzess = kommentarZeilen(spec, processTarget, '');
  if (amProzess.length) out.push('### Offene Kommentare zum Prozess', '', ...amProzess, '');
  out.push('## Ablauf', '');
  fachlichSteps(spec, spec.steps, 0, out);

  const open = collectOpen(spec.steps);
  if (open.length) {
    out.push('', '## Offene Punkte', '');
    for (const [name, q] of open) out.push(`- **${name}**: ${q}`);
  }
  out.push('', '---', '',
    `Schritte: ${Object.values(counts).reduce((a, b) => a + b, 0)} — ` +
    Object.entries(counts).filter(([, n]) => n > 0)
      .map(([k, n]) => `${STATUS_META[k as Status].label} ${n}`).join(' · '));
  return out.join('\n');
}

function collectOpen(steps: Step[], out: Array<[string, string]> = []): Array<[string, string]> {
  for (const s of steps) {
    if (s.open) out.push([s.name, s.open]);
    collectOpen(s.children ?? [], out);
    for (const b of s.branches ?? []) collectOpen(b.steps, out);
    for (const e of s.errors ?? []) collectOpen(e.steps ?? [], out);
  }
  return out;
}

// ── Orchescala-Export ────────────────────────────────────────────────────────
// Bewusst flach und explizit: jeder Schritt bekommt einen Abschnitt mit
// stabiler ID, damit eine KI daraus direkt Worker, Domain und Simulation
// ableiten kann, ohne im Baum navigieren zu müssen. Der Baum steht davor
// als Überblick.
function outline(steps: Step[], depth: number, out: string[]) {
  for (const s of steps) {
    if (s.kind === 'goto') {
      out.push(`${bullet(depth)} ${s.back ? '↻' : '→'} \`${s.gotoId}\``);
      continue;
    }
    const marks = [
      s.loop ? '↻' : '',
      s.errors?.length ? '⚠' : '',
    ].filter(Boolean).join(' ');
    out.push(`${bullet(depth)} \`${s.id}\` · ${KIND_LABEL[s.kind]} · ${s.name}${marks ? ` ${marks}` : ''}`);
    for (const b of s.branches ?? []) {
      out.push(`${bullet(depth + 1)} [${b.label}]`);
      outline(b.steps, depth + 2, out);
    }
    for (const e of s.errors ?? []) {
      if (!e.steps?.length) continue;
      out.push(`${bullet(depth + 1)} [${e.side ? 'Nebenpfad' : 'Fehler'} ${e.code}]`);
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
  const byId = new Map((model?.services ?? []).map(s => [s.id, s] as [string, ServiceDef]));
  const out: string[] = [
    `# ${spec.name} — Orchescala-Spezifikation`,
    '',
    ...table([
      ['Prozess-ID', `\`${spec.processId ?? ''}\``],
      ['Projekt', `\`${spec.project ?? ''}\``],
      ['Titel', spec.title],
      ['Status', STATUS_META[spec.status].label],
      ['Engine', engineLabel(spec.engine)],
      ['Stand', spec.updatedAt],
      ...(spec.timeToLive ? [['Time to Live', `${spec.timeToLive} Tage`]] : []),
      ...(spec.sourceUrl ? [['Quelle', spec.sourceUrl]] : []),
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
    if (s.assignee) meta.push(['Assignee', `\`${s.assignee}\``]);
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
      out.push(...table(used(s.inputs).map(i => [`\`${i.name}\``, `\`${i.expression}\``, i.description ?? '']), ['Parameter', 'Ausdruck', 'Bedeutung']));
    }
    if (off(s.inputs).length) {
      out.push(`*Nicht verwendet:* ${off(s.inputs).map(i => `\`${i.name}\``).join(', ')}`, '');
    }
    if (used(s.outputs).length) {
      out.push('**Ausgaben**', '');
      out.push(...table(used(s.outputs).map(o => [`\`${o.name}\``, `\`${o.expression}\``, o.description ?? '']), ['Variable', 'Ausdruck', 'Bedeutung']));
    }
    if (off(s.outputs).length) {
      out.push(`*Nicht verwendet:* ${off(s.outputs).map(o => `\`${o.name}\``).join(', ')}`, '');
    }
    if (s.errors?.length) {
      out.push('**Fehler und Nebenpfade**', '');
      out.push(...table(s.errors.map((e: ErrorHandling) => [
        `\`${e.code}\``,
        e.side ? 'Nebenpfad' : e.interrupting === false ? 'Fehler, nicht unterbrechend' : 'Fehler, unterbrechend',
        e.steps?.length ? e.steps.map(x => `\`${x.id}\``).join(' → ') : '',
      ]), ['Fehler', 'Art', 'Behandlung']));
    }
    if (s.branches?.length) {
      out.push('**Zweige**', '');
      out.push(...table(s.branches.map((b: Branch) => [
        b.label, b.condition ? `\`${b.condition}\`` : (b.isDefault ? 'Standardzweig' : ''),
        b.steps.filter(x => x.kind !== 'goto').map(x => `\`${x.id}\``).join(' → ') || '(leer)',
      ]), ['Zweig', 'Bedingung', 'Schritte']));
    }
    if (s.mock) out.push('**Mock**', '', '```json', s.mock, '```', '');
    if (s.notes) out.push('**Technische Notiz**', '', s.notes, '');
    if (s.open) out.push(`> ❓ **Offen:** ${s.open}`, '');
    const zeilen = kommentarZeilen(spec, stepTarget(s.id), '');
    if (zeilen.length) out.push('**Offene Kommentare**', '', ...zeilen, '');
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
export function exportSpec(spec: ProcessSpec, kind: ExportKind, model: Model | null, bpmn = ''): string {
  if (kind === 'bpmn') return bpmn || '<!-- Zu dieser Spezifikation liegt (noch) kein Diagramm vor. -->';
  if (kind === 'json') return JSON.stringify(spec, null, 2);
  if (kind === 'scala') return scalaBundle(spec, model);
  if (kind === 'fachlich') return exportFachlich(spec);
  return exportOrchescala(spec, model);
}

export function exportFileName(spec: ProcessSpec, kind: ExportKind): string {
  return `${spec.slug}-${kind}.${EXPORT_META[kind].ext}`;
}
