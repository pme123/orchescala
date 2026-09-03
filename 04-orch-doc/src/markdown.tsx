// Markdown → HTML with `marked`. Relative links and images are resolved against
// the page's folder so the hand-written pages work unchanged.
import { marked } from 'marked';
import { useMemo } from 'react';

export function Markdown({ text, base, className = '' }: { text: string; base?: string; className?: string }) {
  const html = useMemo(() => {
    const r = new marked.Renderer();
    const resolve = (href: string) => /^(https?:|mailto:|#|\/)/i.test(href) || !base ? href : `${base}${href}`;
    r.image = ({ href, title, text }) => `<img src="${resolve(href)}" alt="${text ?? ''}"${title ? ` title="${title}"` : ''} loading="lazy">`;
    r.link = ({ href, title, tokens }) => {
      const ext = /^https?:/i.test(href);
      return `<a href="${resolve(href)}"${title ? ` title="${title}"` : ''}${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${r.parser.parseInline(tokens)}</a>`;
    };
    return marked.parse(text, { renderer: r, gfm: true, breaks: false }) as string;
  }, [text, base]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Inline markdown (release-note entries: links, code) */
export function InlineMd({ text }: { text: string }) {
  const html = useMemo(() => marked.parseInline(text, { gfm: true }) as string, [text]);
  return <span className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
