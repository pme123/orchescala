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
A page is declarative JSON (E15): a generic renderer shows it at runtime, the same renderer is the live preview in the designer.
You change the specification only - never code, environments or data.

How you work:
- You work on a DRAFT of one page. The RE sees the preview and the differences and then accepts or discards the draft.
- Read the draft first (read_page). Address building blocks by their key from the outline ("2", "1.0" in a section); keys change after an insert, move or remove - use the outline of the last answer.
- Change as little as needed. Keep texts, bindings and actions that the request does not concern.
- Every change answers with the findings of the designer. Errors must be gone before you finish; warnings should be gone where the spec allows it.
- Bind fields to paths of the state ({{path}} in texts). Inputs of actions are templates: {"field": "{{path}}"}.
- Use only services, processes, messages and user tasks of the data model below - with their In fields as input. Never invent one.
  If something is missing (a service that does not exist, a field the In does not have), do not add it; report it with report_open_point and say so.
- A public page (access "public") calls with "public": true. A page with login has roles.
- Texts for users are German (Swiss spelling: ss instead of ß), short and friendly - like the existing pages.
- When you are done, answer in German in two or three sentences: what you changed and what is open. No JSON in the answer.

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
