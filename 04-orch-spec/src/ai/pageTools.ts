// Stage A of the AI mode: Claude changes a page as a draft (E19). The tools are the operations of the
// designer (model.ts: insertBlock, updateBlock, relocateBlock, removeBlock) and its findings
// (pageFindings) - the same checks as by hand. A tool that would make the page unreadable for the
// renderer (pageProblem) changes nothing and answers with the error.
import type { Component, Page } from '../pages/runtime/spec';
import { pageProblem } from '../pages/runtime/validate';
import {
  blockAt, flatten, insertBlock, pageFindings, placeBlock, relocateBlock, removeBlock, updateBlock,
  type BlockKey, type PageFinding, type Place, type Targets,
} from '../pages/designer/model';
import { failed, isObject, json, type ToolKit, type ToolOutcome } from './toolkit';

/** The draft of one page - what Claude changes until the RE accepts or discards it. */
export type PageDraft = {
  slug: string;
  /** the page as it was when the draft started - for the differences */
  base: Page;
  page: Page;
  /** what Claude cannot do with the spec - a missing service, a question to the developer */
  openPoints: string[];
};

export const startDraft = (slug: string, page: Page): PageDraft => ({ slug, base: page, page, openPoints: [] });

/** Has Claude changed the page (or reported something)? Otherwise there is nothing to accept. */
export const draftChanged = (d: PageDraft) => JSON.stringify(d.base) !== JSON.stringify(d.page);

/** What the tools know besides the draft - the targets (services …) and the other pages, read only. */
export type PageContext = { targets: Targets; others: { slug: string; page: Page }[] };

/** The outline with the keys - what Claude needs to address a building block. */
export function outlineOf(page: Page): string {
  const line = ({ key, block, depth }: { key: BlockKey; block: Component; depth: number }) => {
    const { body: _body, ...own } = block as Component & { body?: unknown };
    return `${'  '.repeat(depth)}${key} ${json(own)}`;
  };
  return flatten(page.body).map(line).join('\n') || '(keine Bausteine)';
}

/** The findings of the draft - errors and warnings; the hints (info) only on request. */
export const findingsOf = (d: PageDraft, ctx: PageContext, withInfo = false): PageFinding[] =>
  pageFindings(d.page, ctx.targets, [d.page, ...ctx.others.filter((o) => o.slug !== d.slug).map((o) => o.page)])
    .filter((f) => withInfo || f.level !== 'info');

const findingsText = (fs: PageFinding[]) =>
  fs.length ? fs.map((f) => `- ${f.level}${f.key !== undefined ? ` [${f.key}]` : ''}: ${f.message}`).join('\n') : 'keine';

const PLACES: Place[] = ['before', 'after', 'inside'];
const asKey = (v: unknown): v is BlockKey => typeof v === 'string' && /^\d+(\.\d+)*$/.test(v);

const BLOCK_SCHEMA = {
  type: 'object',
  description: 'A building block as in the catalog (Component) - e.g. {"type":"fields","label":"Kontakt","fields":[…]}. A section with its body.',
};

const tools: ToolKit<PageDraft>['tools'] = [
  {
    name: 'read_page',
    description: 'Reads the draft of the page (without slug) or another page of the app (read only): the JSON and the outline with the keys of the building blocks.',
    input_schema: { type: 'object', properties: { slug: { type: 'string', description: 'another page - empty for the draft' } } },
  },
  {
    name: 'insert_block',
    description: 'Inserts a building block before or after the block `at`, or as the last one inside the section `at`. Without `at` at the end of the page. Answers with the new key, the outline and the findings.',
    input_schema: {
      type: 'object',
      properties: {
        block: BLOCK_SCHEMA,
        at: { type: 'string', description: 'key of a building block, e.g. "2" or "1.0"' },
        place: { type: 'string', enum: PLACES },
      },
      required: ['block'],
    },
  },
  {
    name: 'update_block',
    description: 'Replaces the building block at `key` by `block` (the whole block, e.g. a fields block with one more field). Answers with the outline and the findings.',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, block: BLOCK_SCHEMA }, required: ['key', 'block'] },
  },
  {
    name: 'move_block',
    description: 'Moves the building block `key` before or after the block `to`, or into the section `to`. Answers with the new key and the outline.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' }, to: { type: 'string' }, place: { type: 'string', enum: PLACES } },
      required: ['key', 'to', 'place'],
    },
  },
  {
    name: 'remove_block',
    description: 'Removes the building block `key` (a section with its content).',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'update_page',
    description: 'Changes the properties of the page: title, path, access ("public" or {"roles":[…]}), state (the initial state) and load (the actions on load). Only what is given changes; the building blocks stay.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        path: { type: 'string' },
        access: { description: '"public" or {"roles": ["…"]}' },
        state: { type: 'object' },
        load: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'check_page',
    description: 'The findings of the draft as in the designer - errors, warnings and hints. Errors must be gone before the draft goes to the requirements engineer.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'report_open_point',
    description: 'Reports what cannot be done in the spec - above all a service (worker) that is missing in the catalog. Do not invent it; a developer implements it.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

/** The draft with a new page - only if the renderer can show it; otherwise the error, the draft stays. */
function withPage(d: PageDraft, page: Page, ctx: PageContext, summary: string, extra: Record<string, unknown> = {}): ToolOutcome<PageDraft> {
  const problem = pageProblem(page);
  if (problem) return failed(d, `Nicht übernommen – so kann der Renderer die Seite nicht zeigen: ${problem}`, `abgelehnt: ${problem}`);
  const next = { ...d, page };
  const findings = findingsOf(next, ctx);
  return {
    draft: next,
    content: `ok\n${json(extra)}\nAufbau:\n${outlineOf(page)}\nBefunde:\n${findingsText(findings)}`,
    summary,
  };
}

const blockLabel = (b: Component) =>
  'label' in b && b.label ? `«${b.label}»` : 'text' in b && b.text ? `«${b.text}»` : '';

export function runPageTool(name: string, input: unknown, d: PageDraft, ctx: PageContext): ToolOutcome<PageDraft> {
  const args = isObject(input) ? input : {};
  const body = d.page.body;
  switch (name) {
    case 'read_page': {
      const slug = typeof args.slug === 'string' && args.slug && args.slug !== d.slug ? args.slug : null;
      const other = slug ? ctx.others.find((o) => o.slug === slug) : null;
      if (slug && !other) return failed(d, `Eine Seite «${slug}» gibt es nicht. Seiten: ${ctx.others.map((o) => o.slug).join(', ')}`);
      const page = other?.page ?? d.page;
      return { draft: d, content: `${json(page)}\nAufbau:\n${outlineOf(page)}`, summary: `Seite «${slug ?? d.slug}» gelesen` };
    }
    case 'insert_block': {
      if (!isObject(args.block)) return failed(d, '«block» fehlt oder ist kein Objekt.');
      const block = args.block as Component;
      const place = PLACES.includes(args.place as Place) ? (args.place as Place) : 'after';
      if (args.at !== undefined && !(asKey(args.at) && blockAt(body, args.at))) return failed(d, `Einen Baustein «${String(args.at)}» gibt es nicht.`);
      const r = args.at === undefined ? insertBlock(body, block) : placeBlock(body, block, args.at as BlockKey, place);
      return withPage(d, { ...d.page, body: r.body }, ctx, `Baustein ${block.type} ${blockLabel(block)} eingefügt`.trim(), { key: r.key });
    }
    case 'update_block': {
      if (!asKey(args.key) || !blockAt(body, args.key)) return failed(d, `Einen Baustein «${String(args.key)}» gibt es nicht.`);
      if (!isObject(args.block)) return failed(d, '«block» fehlt oder ist kein Objekt.');
      // the ID stays with the building block - its comments and its entries in the change log hang on it
      const old = blockAt(body, args.key)!;
      const block = { ...(args.block as Component), ...(old.id ? { id: old.id } : {}) } as Component;
      return withPage(d, { ...d.page, body: updateBlock(body, args.key, () => block) }, ctx, `Baustein ${args.key} ${blockLabel(block)} geändert`.replace(/\s+/g, ' '));
    }
    case 'move_block': {
      if (!asKey(args.key) || !blockAt(body, args.key)) return failed(d, `Einen Baustein «${String(args.key)}» gibt es nicht.`);
      if (!asKey(args.to) || !blockAt(body, args.to)) return failed(d, `Einen Baustein «${String(args.to)}» gibt es nicht.`);
      const place = PLACES.includes(args.place as Place) ? (args.place as Place) : 'after';
      const r = relocateBlock(body, args.key, args.to, place);
      if (r.body === body) return failed(d, 'Nicht verschoben – in sich selbst oder an dieselbe Stelle geht nicht.');
      return withPage(d, { ...d.page, body: r.body }, ctx, `Baustein ${args.key} verschoben`, { key: r.key });
    }
    case 'remove_block': {
      if (!asKey(args.key) || !blockAt(body, args.key)) return failed(d, `Einen Baustein «${String(args.key)}» gibt es nicht.`);
      const b = blockAt(body, args.key)!;
      return withPage(d, { ...d.page, body: removeBlock(body, args.key) }, ctx, `Baustein ${b.type} ${blockLabel(b)} entfernt`.trim());
    }
    case 'update_page': {
      const props = ['title', 'path', 'access', 'state', 'load'] as const;
      const given = props.filter((p) => args[p] !== undefined);
      if (!given.length) return failed(d, 'Nichts angegeben – title, path, access, state oder load.');
      const page = { ...d.page, ...Object.fromEntries(given.map((p) => [p, args[p]])) } as Page;
      return withPage(d, page, ctx, `Seite geändert: ${given.join(', ')}`);
    }
    case 'check_page': {
      const findings = findingsOf(d, ctx, true);
      return { draft: d, content: findingsText(findings), summary: `geprüft: ${findings.filter((f) => f.level === 'error').length} Fehler, ${findings.filter((f) => f.level === 'warning').length} Warnungen` };
    }
    case 'report_open_point': {
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!text) return failed(d, '«text» fehlt.');
      return { draft: { ...d, openPoints: [...d.openPoints, text] }, content: 'notiert', summary: `offener Punkt: ${text}` };
    }
    default:
      return failed(d, `Ein Werkzeug «${name}» gibt es nicht.`);
  }
}

/** The tools of stage A for one page. */
export const pageToolKit = (ctx: PageContext): ToolKit<PageDraft> => ({
  tools,
  run: (name, input, d) => runPageTool(name, input, d, ctx),
  remainingErrors: (d) => newErrors(d, ctx),
});

/** The errors the draft has and the page before did not - those Claude corrects itself. An error the
  * page already had is the RE's business (Claude may fix it, but is not sent back for it). */
export function newErrors(d: PageDraft, ctx: PageContext): string[] {
  if (!draftChanged(d)) return [];
  const errors = (page: Page) => findingsOf({ ...d, page }, ctx).filter((f) => f.level === 'error').map((f) => f.message);
  const before = new Set(errors(d.base));
  return errors(d.page).filter((m) => !before.has(m));
}
