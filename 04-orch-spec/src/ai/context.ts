// What Claude knows at the start of a conversation: the catalog of the building blocks and the data
// model of the app (services with In/Out, processes, messages, user tasks) and the list of pages -
// the instructions come from the skill of the task in the studio (E23), which puts them first. Only
// the spec - no customer data (E19); the preview works with sample data.
//
// Prompt caching: two system blocks, each with a breakpoint. The first (the catalog, after the
// instructions of the skill) is the same for every project, the second (data model) for one
// conversation - it is built once at its start and then kept, so the prefix stays byte for byte the same.
import type { BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { PField, Targets } from '../pages/designer/model';
import type { App, Page } from '../pages/runtime/spec';

// The instructions for pages are the skill's (uiCreator in the studio) - the studio puts them in
// front of these blocks; here only the context.
const CATALOG_INTRO = 'The catalog of the building blocks (TypeScript types of the page specification, spec.ts):';

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
    { type: 'text', text: `${CATALOG_INTRO}\n${catalog.trim()}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `The data model of this app:\n${dataModelText(targets)}\n\n${pagesText(pages, app)}`, cache_control: { type: 'ephemeral' } },
  ];
}

/** The first request of a conversation names the page the draft is about. */
export const pagePrompt = (slug: string, text: string, first: boolean) =>
  first ? `Die Seite im Entwurf: «${slug}».\n\n${text}` : text;

// ---------------------------------------------------------------- stage B: processes

// The instructions for processes and service orchestrations are the skills' (processCreator,
// serviceOrchestrator in the studio) - here only the context.

const servicesText = (services: Targets['services']) =>
  services.map((s) => `- ${s.topic} (${s.name})${s.descr ? ` – ${s.descr.replace(/\s+/g, ' ').slice(0, 160)}` : ''}\n  In: {${fieldsText(s.in)}}\n  Out: {${fieldsText(s.out)}}`);

/** The system of a conversation about a process - the workers of the domain with In/Out and the other processes. */
export function processSystem(targets: Targets): BetaTextBlockParam[] {
  const workers = [
    '# Workers of the domain (service step: topic)',
    ...servicesText(targets.services),
    '# Processes of the app',
    ...targets.processes.map((p) => `- ${p.key} (${p.title})`),
  ].join('\n');
  return [{ type: 'text', text: `The data model of this app:\n${workers}`, cache_control: { type: 'ephemeral' } }];
}

/** The system of a conversation about a service orchestration - the services it can call, with In/Out. */
export function orchestrationSystem(services: Targets['services']): BetaTextBlockParam[] {
  const text = ['# Services the orchestration can call (service step: topic)', ...servicesText(services)].join('\n');
  return [{ type: 'text', text: `The data model of this orchestration:\n${text}`, cache_control: { type: 'ephemeral' } }];
}

export const processPrompt = (title: string, id: string, text: string, serviceMode = false) =>
  `${serviceMode ? 'Die Orchestrierung' : 'Der Prozess'} im Entwurf: «${title}» (${id}).\n\n${text}`;
