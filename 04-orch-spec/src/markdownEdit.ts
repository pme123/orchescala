// Markdown fields (initial situation, business description, pattern): display
// safely and format a selection — as in arch-review, but without
// text colors: the text goes into the exports (Markdown, Scala comments),
// where only standard Markdown counts. Entered HTML is never
// executed in the display, links only with http(s)/mailto.
import { Marked, type Tokens } from 'marked';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const md = new Marked({ gfm: true, breaks: true });
md.use({
  renderer: {
    // entered HTML only as text
    html(token: Tokens.HTML | Tokens.Tag) { return escapeHtml(token.text); },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      return /^(https?:|mailto:)/i.test(token.href)
        ? `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : text;
    },
    image(token: Tokens.Image) { return escapeHtml(token.text); },
  },
});

/** Markdown → HTML for display (without executable HTML). */
export const renderMarkdown = (text: string): string => md.parse(text ?? '', { async: false }) as string;

// ── Formatting a selection (textarea) ────────────────────────────────────────

export type Edit = { value: string; start: number; end: number };

/** Wrap the selection with before/after — if it is already wrapped, it is unwrapped. */
export function toggleWrap(v: string, s: number, e: number, before: string, after: string): Edit {
  if (s >= before.length && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
    return { value: v.slice(0, s - before.length) + v.slice(s, e) + v.slice(e + after.length), start: s - before.length, end: e - before.length };
  }
  const sel = v.slice(s, e);
  if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
    const inner = sel.slice(before.length, sel.length - after.length);
    return { value: v.slice(0, s) + inner + v.slice(e), start: s, end: s + inner.length };
  }
  return { value: v.slice(0, s) + before + sel + after + v.slice(e), start: s + before.length, end: e + before.length };
}

/** Selection as a link `[Text](https://)` — afterwards selects the address for overwriting. */
export function makeLink(v: string, s: number, e: number): Edit {
  const sel = v.slice(s, e) || 'Link';
  const url = 'https://';
  const value = `${v.slice(0, s)}[${sel}](${url})${v.slice(e)}`;
  const urlStart = s + sel.length + 3;
  return { value, start: urlStart, end: urlStart + url.length };
}

/** Selected lines as a bullet list «- » — if all already are one, it is undone. */
export function toggleList(v: string, s: number, e: number): Edit {
  const from = v.lastIndexOf('\n', s - 1) + 1;
  const toIdx = v.indexOf('\n', e);
  const to = toIdx === -1 ? v.length : toIdx;
  const lines = v.slice(from, to).split('\n');
  const all = lines.every(l => /^\s*[-*•]\s+/.test(l) || !l.trim());
  const next = lines.map(l => (!l.trim() ? l : all ? l.replace(/^(\s*)[-*•]\s+/, '$1') : `- ${l}`)).join('\n');
  return { value: v.slice(0, from) + next + v.slice(to), start: from, end: from + next.length };
}

/** Remove bold, italic, code and links in the selection (the link text stays). */
export function clearFormat(v: string, s: number, e: number): Edit {
  const plain = v.slice(s, e)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<![\w*])\*([^*]+)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_([^_]+)_(?![\w_])/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
  return { value: v.slice(0, s) + plain + v.slice(e), start: s, end: s + plain.length };
}
