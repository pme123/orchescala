// What Claude knows at the start of a conversation: the instructions, the catalog of the building
// blocks and the data model of the app (services with In/Out, processes, messages, user tasks) and
// the list of pages. Only the spec - no customer data (E19); the preview works with sample data.
//
// Prompt caching: two system blocks, each with a breakpoint. The first (instructions + catalog) is
// the same for every project, the second (data model) for one conversation - it is built once at
// its start and then kept, so the prefix stays byte for byte the same.
import type { BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { PField, Targets } from '../pages/designer/model';
import type { App, Page } from '../pages/runtime/spec';

const PAGE_INSTRUCTIONS = `You help a requirements engineer (RE) of a bank or company to specify the pages of an app in orch-spec.
Always answer in German (Swiss spelling: ss instead of ß) - the RE works in German.
A page is declarative JSON (E15): a generic renderer shows it at runtime, the same renderer is the live preview in the designer.
You change the specification only - never code, environments or data.

How you work:
- You work on a DRAFT of one page. The RE sees the preview and the differences and then accepts or discards the draft.
- Read the draft first (read_page). Address building blocks by their key from the outline ("2", "1.0" in a section); keys change after an insert, move or remove - use the outline of the last answer.
- Change as little as needed. Keep texts, bindings and actions that the request does not concern.
- Every change answers with the findings of the designer. Errors must be gone before you finish; warnings should be gone where the spec allows it.
- Bind fields to paths of the state ({{path}} in texts). Inputs of actions are templates: {"field": "{{path}}"}.
- Call only services, processes, messages and user tasks of the data model below - with their In fields as input. Never invent one and never call one that is not there.
- If the request needs something the data model does not have, do the part of the page anyway and report the rest with report_open_point:
  a field the In of a service or process does not have yet: add the input to the page (bound in the state, e.g. contact.branch) and pass it in the input of the action - report that the In needs the field;
  a service that does not exist: do not call it; build what works without it (e.g. a free text instead of a list) and report the missing service.
  Say in your answer what is open.
- A public page (access "public") calls with "public": true. A page with login has roles.
- Texts for users are German (Swiss spelling: ss instead of ß), short and friendly - like the existing pages.
- When you are done, answer in two or three German sentences: what you changed and what is open. No JSON in the answer.

The catalog of the building blocks (TypeScript types of the page specification, spec.ts):
`;

/** The fields of a type in one line: `topic: Topic(advice|mortgage), days: Int, from?: LocalDate, slots: [Slot{start: LocalDateTime, …}]`. */
export function fieldsText(fields: PField[], depth = 0): string {
  return fields.map((f) => {
    const inner = f.values?.length ? `(${f.values.join('|')})` : f.fields?.length && depth < 2 ? `{${fieldsText(f.fields, depth + 1)}}` : '';
    const type = `${f.type}${inner}`;
    return `${f.name}${f.optional ? '?' : ''}: ${f.collection ? `[${type}]` : type}`;
  }).join(', ');
}

/** The data model of the app as text - what a page can call. Deterministic: same targets, same text. */
export function dataModelText(targets: Targets): string {
  const lines = [
    '# Services (do: "call", service: <topic>; result: the Out)',
    ...targets.services.map((s) => `- ${s.topic} (${s.name})${s.descr ? ` – ${s.descr.replace(/\s+/g, ' ').slice(0, 160)}` : ''}\n  In: {${fieldsText(s.in)}}\n  Out: {${fieldsText(s.out)}}`),
    '# Processes (do: "start", process: <key>)',
    ...targets.processes.map((p) => `- ${p.key} (${p.title})\n  In: {${fieldsText(p.in)}}`),
    '# Messages (do: "message", name: <name>, businessKey required)',
    ...targets.messages.map((m) => `- ${m.name} (process ${m.process})\n  In: {${fieldsText(m.in)}}`),
    '# User tasks (do: "completeTask", taskKey: <key>, taskId: from the URL)',
    ...targets.userTasks.map((t) => `- ${t.key} (${t.name}, process ${t.process})\n  In: {${fieldsText(t.in)}}\n  Out: {${fieldsText(t.out)}}`),
  ];
  return lines.join('\n');
}

/** The pages of the app - path, title, access; the content is read with read_page. */
export function pagesText(pages: { slug: string; page: Page }[], app: App | undefined): string {
  const access = (p: Page) => (p.access === 'public' ? 'public' : `login${p.access.roles.length ? ` (${p.access.roles.join(', ')})` : ''}`);
  return [
    `# App: ${app?.title ?? '(ohne Titel)'}${app?.home ? ` – start page /${app.home}` : ''}`,
    ...(app?.labels ? [`Texts for values (|label:<name>): ${Object.keys(app.labels).sort().join(', ')}`] : []),
    '# Pages (slug – /path – title – access)',
    ...[...pages].sort((a, b) => a.slug.localeCompare(b.slug)).map(({ slug, page }) => `- ${slug} – /${page.path} – ${page.title} – ${access(page)}`),
  ].join('\n');
}

/** The system of a conversation about pages - built once at its start (see above). */
export function pageSystem(catalog: string, targets: Targets, pages: { slug: string; page: Page }[], app: App | undefined): BetaTextBlockParam[] {
  return [
    { type: 'text', text: `${PAGE_INSTRUCTIONS}\n${catalog.trim()}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `The data model of this app:\n${dataModelText(targets)}\n\n${pagesText(pages, app)}`, cache_control: { type: 'ephemeral' } },
  ];
}

/** The first request of a conversation names the page the draft is about. */
export const pagePrompt = (slug: string, text: string, first: boolean) =>
  first ? `Die Seite im Entwurf: «${slug}».\n\n${text}` : text;

// ---------------------------------------------------------------- stage B: processes

const PROCESS_INSTRUCTIONS = `You help a requirements engineer (RE) of a bank or company to specify a process of an app in orch-spec.
Always answer in German (Swiss spelling: ss instead of ß) - the RE works in German.
The process runs on Camunda (BPMN); orch-spec derives the flow (steps, user tasks, decisions, error paths) from the diagram and keeps the business details in the spec.
You change the specification only - never code, environments or data.

How you work:
- You work on a DRAFT of one process: its diagram and its spec. The RE sees the flow and the differences and then accepts or discards the draft.
- Read the draft first (read_process). Address steps by their ID from the flow. After a decision, address a branch by its label.
- Structure with add_step, add_decision, add_error_path, remove_step, rename_step; details (description, who sees a user task) with update_step.
- Names of steps are German and short, as in the existing process («Adresse prüfen»). Error codes are kebab-case («address-invalid»).
- A service step calls a worker of the data model below by its topic. Never invent a worker. If one is missing, do not add it: report it with report_open_point
  and, if the RE wants the step in the flow now, insert a manual step with the same name as a placeholder and say so.
- Conditions of branches are FEEL on the process variables (the In of the process, the outputs of earlier steps), e.g. address.valid = true.
- A new user task or worker needs an interaction with In/Out in the data model of the process - the RE creates it (Datenmodell → aus dem Ablauf);
  the warning «Noch keine Interaktion» is expected, mention it as open.
- Every change answers with the findings. Errors that your change brought must be gone before you finish.
- When you are done, answer in two or three German sentences: what you changed and what is open. No JSON, no XML in the answer.
`;

/** The system of a conversation about a process - the workers of the domain with In/Out and the other processes. */
export function processSystem(targets: Targets): BetaTextBlockParam[] {
  const workers = [
    '# Workers of the domain (service step: topic)',
    ...targets.services.map((s) => `- ${s.topic} (${s.name})${s.descr ? ` – ${s.descr.replace(/\s+/g, ' ').slice(0, 160)}` : ''}\n  In: {${fieldsText(s.in)}}\n  Out: {${fieldsText(s.out)}}`),
    '# Processes of the app',
    ...targets.processes.map((p) => `- ${p.key} (${p.title})`),
  ].join('\n');
  return [
    { type: 'text', text: PROCESS_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `The data model of this app:\n${workers}`, cache_control: { type: 'ephemeral' } },
  ];
}

export const processPrompt = (title: string, id: string, text: string) => `Der Prozess im Entwurf: «${title}» (${id}).\n\n${text}`;
