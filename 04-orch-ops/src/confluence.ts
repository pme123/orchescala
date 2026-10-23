// Import of the Confluence page that documents recurring operational errors.
//
// Reads the table «Dokumentation wiederkehrender Fehler» and the section
// «Wiki mit How-to Infos». Works with both ways the page can be saved:
//
//  · «Save page as» — the rendered HTML
//  · «View source» → save — the original is then wrapped line by line
//    in `<td class="line-content">` and is reassembled here first
//
// Cell contents become Markdown: paragraphs, lists, code blocks (error
// messages, curl), links, mentions and status lozenges are preserved.
// Runs in the browser (DOMParser) and in Node (linkedom, tools/).
import type { ErrorEntry, StatusColor, StatusDef } from './types.ts';
import { slugify } from './util.ts';

export type ParseHtml = (html: string) => Document;

export interface ConfluenceImport {
  errors: Omit<ErrorEntry, 'createdAt' | 'updatedAt'>[];
  statuses: StatusDef[];
  howto: string;
  /** Columns that were recognized — for the feedback in the admin */
  columns: string[];
}

/** The page documents errors «from the 2nd occurrence» — that is the default initial count.
  * The page itself has no counter; a count column (Anzahl/Count) wins if there is one. */
export const IMPORT_COUNT = 2;

export interface ParseOptions {
  /** initial count of every imported error (0, 1, 2 …) — default IMPORT_COUNT */
  initialCount?: number;
}

const SKIP = new Set(['STYLE', 'SCRIPT', 'BUTTON', 'SVG', 'FIGURE', 'TEMPLATE', 'NOSCRIPT', 'COLGROUP', 'INPUT', 'NAV']);

const el = (n: Node): n is Element => n.nodeType === 1;
const tag = (n: Element) => n.tagName.toUpperCase();
const attr = (n: Element, a: string) => n.getAttribute(a);

// ── Unwrap the view-source variant ───────────────────────────────────────────
function unwrapViewSource(doc: Document, parse: ParseHtml): Document {
  const lines = doc.querySelectorAll('td.line-content');
  if (lines.length < 5) return doc;
  const src = Array.from(lines, l => l.textContent ?? '').join('\n');
  return parse(src);
}

// ── Emojis ───────────────────────────────────────────────────────────────────
function emoji(e: Element): string {
  const id = attr(e, 'data-emoji-id') ?? '';
  const short = attr(e, 'data-emoji-short-name') || attr(e, 'data-emoji-text') || '';
  if (/^[0-9a-f]+(-[0-9a-f]+)*$/i.test(id)) {
    try { return String.fromCodePoint(...id.split('-').map(h => parseInt(h, 16))); } catch { /* fall through */ }
  }
  const known: Record<string, string> = {
    question_mark: '❓', warning: '⚠️', check_mark: '✅', cross_mark: '❌', info: 'ℹ️', light_bulb: '💡',
    tick: '✅', error: '❌', star: '⭐', thumbs_up: '👍', thumbs_down: '👎',
  };
  const name = id.replace(/^atlassian-/, '') || short.replace(/:/g, '');
  return known[name] ?? (short || '');
}

// ── HTML → Markdown ──────────────────────────────────────────────────────────
function codeBlock(e: Element): string {
  const rows = e.querySelectorAll('[data-ds--code--row]');
  let text: string;
  if (rows.length) {
    text = Array.from(rows, r => {
      let s = '';
      r.childNodes.forEach(c => {
        if (el(c) && (c.hasAttribute('data-ds--line-number') || (attr(c, 'class') ?? '').includes('linenumber'))) return;
        s += c.textContent ?? '';
      });
      return s.replace(/\u00a0/g, ' ').replace(/\s+$/, '');
    }).join('\n');
  } else {
    text = (e.textContent ?? '').replace(/\u00a0/g, ' ');
  }
  text = text.replace(/^\s*\n/, '').replace(/^[ \t]+/, '').replace(/\s+$/, '');
  const fence = text.includes('```') ? '~~~~' : '```';
  return `\n\n${fence}\n${text}\n${fence}\n\n`;
}

function inlineText(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/[ \t\r\n]+/g, ' ');
}

function wrap(mark: string, inner: string): string {
  const t = inner.trim();
  if (!t) return inner;
  const lead = inner.match(/^\s*/)![0], trail = inner.match(/\s*$/)![0];
  return `${lead}${mark}${t}${mark}${trail}`;
}

function link(e: Element): string {
  const href = attr(e, 'href') ?? '';
  let text = inlineText(conv(e)).trim();
  // «[OPS-123]» → «OPS-123»: Jira smart links carry brackets in their text
  const bracketed = text.match(/^\[([^\]]+)\]$/);
  if (bracketed) text = bracketed[1].trim();
  if (!/^https?:\/\//i.test(href)) return text;
  if (!text || text === href) return `<${href}>`;
  return `[${text.replace(/[[\]]/g, m => `\\${m}`)}](${href})`;
}

function list(e: Element, ordered: boolean): string {
  let i = 0;
  const items: string[] = [];
  e.childNodes.forEach(li => {
    if (!el(li) || tag(li) !== 'LI') return;
    i++;
    const prefix = ordered ? `${i}. ` : '- ';
    const body = tidy(conv(li)).replace(/\n{2,}(?!```|~~~~)/g, '\n');
    const indented = body.split('\n').map((l, k) => (k === 0 ? l : ' '.repeat(prefix.length) + l)).join('\n');
    items.push(prefix + indented);
  });
  return `\n\n${items.join('\n')}\n\n`;
}

function conv(node: Node): string {
  let out = '';
  node.childNodes.forEach(c => {
    if (c.nodeType === 3) { out += inlineText(c.textContent ?? ''); return; }
    if (!el(c)) return;
    const t = tag(c);
    if (SKIP.has(t)) return;
    if (attr(c, 'data-testid') === 'renderer-code-block' || t === 'PRE') { out += codeBlock(c); return; }
    if (c.hasAttribute('data-emoji-id')) { out += emoji(c); return; }
    if (attr(c, 'data-node-type') === 'status') { out += wrap('**', inlineText(textOf(c))); return; }
    if (c.hasAttribute('data-mention-id')) { out += inlineText(textOf(c)); return; }
    switch (t) {
      case 'IMG': return;
      case 'BR': out += '  \n'; return;
      case 'HR': out += '\n\n---\n\n'; return;
      case 'A': out += link(c); return;
      case 'STRONG': case 'B': out += wrap('**', conv(c)); return;
      case 'EM': case 'I': out += wrap('*', conv(c)); return;
      case 'S': case 'DEL': out += wrap('~~', conv(c)); return;
      case 'CODE': {
        const s = inlineText(textOf(c)).trim();
        out += s ? `\`${s.replace(/`/g, "'")}\`` : '';
        return;
      }
      case 'P': out += `\n\n${conv(c).trim()}\n\n`; return;
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        out += `\n\n${'#'.repeat(Number(t[1]))} ${conv(c).trim()}\n\n`; return;
      case 'UL': out += list(c, false); return;
      case 'OL': out += list(c, true); return;
      case 'LI': case 'DIV': case 'SECTION': case 'TABLE': case 'TBODY': case 'TR':
        out += `\n${conv(c)}\n`; return;
      case 'TD': case 'TH': out += ` ${conv(c)} `; return;
      default: out += conv(c);
    }
  });
  return out;
}

/** Collapse blank lines, clean up line ends — code blocks stay untouched */
function tidy(md: string): string {
  const parts = md.split(/(\n(?:```|~~~~)\n[\s\S]*?\n(?:```|~~~~)\n)/);
  return parts.map((p, i) => (i % 2 === 1 ? p : p
    .split('\n').map(l => (l.endsWith('  ') && l.trim() ? l.replace(/\s+$/, '  ') : l.trim())).join('\n')))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function toMarkdown(node: Node): string {
  return tidy(conv(node));
}

/** Plain text, without embedded styles/scripts (Confluence sprinkles them into cells) */
function textOf(node: Node): string {
  let s = '';
  node.childNodes.forEach(c => {
    if (c.nodeType === 3) s += c.textContent ?? '';
    else if (el(c) && !SKIP.has(tag(c))) s += tag(c) === 'P' || tag(c) === 'LI' ? ` ${textOf(c)} ` : textOf(c);
  });
  return s;
}

function plain(node: Node): string {
  return inlineText(textOf(node)).trim();
}

// ── Table ────────────────────────────────────────────────────────────────────
type Field = 'process' | 'title' | 'activity' | 'reporter' | 'status' | 'ticket' | 'workaround' | 'count';

function fieldOf(header: string): Field | null {
  const h = header.toLowerCase();
  if (h.startsWith('prozess')) return 'process';
  if (h.includes('kurzbeschrieb') || h.includes('incident') || h.includes('beschreibung')) return 'title';
  if (h.startsWith('aktivit')) return 'activity';
  if (h.startsWith('erfasser') || h.includes('gemeldet')) return 'reporter';
  if (h.startsWith('status')) return 'status';
  if (h.startsWith('ticket')) return 'ticket';
  if (h.includes('kommentar') || h.includes('workaround')) return 'workaround';
  if (h.includes('anzahl') || h === 'count' || h.includes('vorkommnis')) return 'count';
  return null;
}

function findTable(root: ParentNode): HTMLTableElement | null {
  let best: HTMLTableElement | null = null;
  let bestRows = 0;
  root.querySelectorAll('table').forEach(t => {
    const head = plain(t.querySelector('tr') ?? t).toLowerCase();
    if (!head.includes('prozess') || !head.includes('status')) return;
    const rows = t.querySelectorAll('tr').length;
    if (rows > bestRows) { best = t as HTMLTableElement; bestRows = rows; }
  });
  return best;
}

const STATUS_COLORS: StatusColor[] = ['neutral', 'blue', 'green', 'yellow', 'red', 'purple'];

/** Titles are plain text — strip inline Markdown */
function stripInline(s: string): string {
  return s.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' ').trim();
}

function splitTitle(md: string): { title: string; details: string } {
  const blocks = md.split(/\n\n/);
  const first = blocks[0] ?? '';
  if (!first.startsWith('```') && !first.startsWith('~~~~')) {
    return { title: stripInline(first.replace(/\s*\n\s*/g, ' ')), details: blocks.slice(1).join('\n\n').trim() };
  }
  // only a code block: first line of the error message as title
  const line = md.split('\n').find((l, i) => i > 0 && l.trim()) ?? '';
  return { title: line.trim().slice(0, 140), details: md };
}

function errorId(process: string, title: string, taken: Set<string>): string {
  const base = (`${slugify(process) || 'fehler'}--${slugify(title).slice(0, 60)}`).replace(/-+$/, '');
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

// ── How-to ──────────────────────────────────────────────────────────────────
function howtoSection(root: ParentNode): string {
  const h = Array.from(root.querySelectorAll('h1, h2, h3')).find(x => /how-?to|wiki/i.test(plain(x)));
  if (!h) return '';
  // the heading sits in a wrapper — the wrapper's siblings are the content
  let anchor: Element = h;
  while (anchor.parentElement && !anchor.nextElementSibling) anchor = anchor.parentElement;
  const out: string[] = [];
  for (let s = anchor.nextElementSibling; s; s = s.nextElementSibling) {
    if (s.matches('h1, h2, h3') || s.querySelector('h1, h2, h3, table')) break;
    if (tag(s) === 'HR') continue;
    out.push(toMarkdown(wrapOne(s)));
  }
  return tidy(out.join('\n\n'));
}

// toMarkdown processes children — build a shell around a single element
function wrapOne(e: Element): Node {
  return { childNodes: { forEach: (f: (n: Node) => void) => f(e) } } as unknown as Node;
}

// ── Entry point ─────────────────────────────────────────────────────────────
export function parseConfluence(html: string, parse: ParseHtml, opts: ParseOptions = {}): ConfluenceImport {
  const initialCount = Number.isInteger(opts.initialCount) && opts.initialCount! >= 0 ? opts.initialCount! : IMPORT_COUNT;
  const doc = unwrapViewSource(parse(html), parse);
  const root: ParentNode = doc.querySelector('.ak-renderer-document') ?? doc.querySelector('#main-content') ?? doc;
  const table = findTable(root);
  if (!table) throw new Error('Keine Fehler-Tabelle gefunden (Spalten «Prozess» und «Status» erwartet).');

  const rows = Array.from(table.querySelectorAll('tr'));
  const headerCells = Array.from(rows[0].querySelectorAll('th, td'));
  const fields = headerCells.map(c => fieldOf(plain(c)));
  const columns = headerCells.map(c => plain(c));

  const statusSeen = new Map<string, StatusColor>();
  const taken = new Set<string>();
  const errors: ConfluenceImport['errors'] = [];

  rows.slice(1).forEach(tr => {
    const cells = Array.from(tr.children).filter(c => tag(c) === 'TD' || tag(c) === 'TH');
    if (!cells.length) return;
    const e = {
      process: '', title: '', details: '', activity: '', reporter: '', status: [] as string[],
      ticket: '', workaround: '', count: initialCount,
    };
    let statusNote = '';
    cells.forEach((cell, i) => {
      const f = fields[i];
      if (!f) return;
      switch (f) {
        case 'process': e.process = plain(cell); break;
        case 'activity': e.activity = plain(cell); break;
        case 'reporter': {
          const mentions = Array.from(cell.querySelectorAll('[data-mention-id]'), m => plain(m).replace(/^@/, ''));
          e.reporter = mentions.length ? [...new Set(mentions)].join(', ') : plain(cell);
          break;
        }
        case 'status': {
          cell.querySelectorAll('[data-node-type="status"]').forEach(s => {
            const label = plain(s).toUpperCase();
            if (!label) return;
            if (!e.status.includes(label)) e.status.push(label);
            const col = (attr(s, 'data-color') ?? 'neutral') as StatusColor;
            if (!statusSeen.has(label)) statusSeen.set(label, STATUS_COLORS.includes(col) ? col : 'neutral');
          });
          // whatever stands next to the lozenges (e.g. a question mark) is not lost
          const rest = toMarkdown(cell).replace(/\*\*[^*]+\*\*/g, '').trim();
          if (rest) statusNote = rest;
          if (!e.status.length && rest) e.status.push(rest.toUpperCase());
          break;
        }
        case 'title': Object.assign(e, splitTitle(toMarkdown(cell))); break;
        case 'ticket': e.ticket = toMarkdown(cell); break;
        case 'workaround': e.workaround = toMarkdown(cell); break;
        case 'count': {
          const n = parseInt(plain(cell), 10);
          if (Number.isFinite(n) && n >= 0) e.count = n;
          break;
        }
      }
    });
    if (statusNote && e.status.length) e.workaround = `${e.workaround}\n\n*Status-Notiz aus Confluence:* ${statusNote}`.trim();
    if (!e.process && !e.title && !e.details) return;
    errors.push({ id: errorId(e.process, e.title, taken), ...e, seq: errors.length, lastAction: 'imported' });
  });

  const statuses: StatusDef[] = [...statusSeen].map(([label, color]) => ({ label, color, ...(color === 'green' ? { done: true } : {}) }));
  return { errors, statuses, howto: howtoSection(root), columns };
}
