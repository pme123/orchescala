// Render Markdown safely. The texts come from the shared folder — so raw
// HTML in them is not executed but shown as text, and links only go to
// http(s) and mailto.
//
// Images: only own attachments (`attachments/…` in the folder) are shown —
// they come through the store (local or SharePoint) as object URLs. The app
// does not load images from foreign addresses; those stay a link.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Marked } from 'marked';
import { X } from 'lucide-react';
import { useStore } from './store';
import { isAttachmentPath } from './attachments';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) { return esc(text); },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!/^(https?:|mailto:)/i.test(href)) return text;
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image({ href, text }) {
      if (isAttachmentPath(href)) return `<img data-att="${esc(href)}" alt="${esc(text)}" title="${esc(text || 'Bild')} — Klick: gross" class="att" />`;
      return /^https?:/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text || href)}</a>` : esc(text);
    },
  },
});

export function renderMarkdown(src: string): string {
  return md.parse(src ?? '', { async: false }) as string;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const { resolveAttachment, isDark } = useStore();
  const html = useMemo(() => renderMarkdown(text), [text]);
  const ref = useRef<HTMLDivElement>(null);
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);

  // load attachments
  useEffect(() => {
    let alive = true;
    ref.current?.querySelectorAll<HTMLImageElement>('img[data-att]').forEach(img => {
      const path = img.dataset.att!;
      img.classList.add('att-loading');
      void resolveAttachment(path).then(url => {
        if (!alive) return;
        img.classList.remove('att-loading');
        if (url) img.src = url;
        else { img.classList.add('att-missing'); img.title = `Bild fehlt im Ordner: ${path}`; }
      });
    });
    return () => { alive = false; };
  }, [html, resolveAttachment]);

  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setBig(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [big]);

  if (!text?.trim()) return null;
  return (
    <>
      <div ref={ref} className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }}
        onClick={e => {
          const t = e.target as HTMLElement;
          if (t.tagName === 'IMG' && t.dataset.att && (t as HTMLImageElement).src) {
            e.stopPropagation();
            setBig({ src: (t as HTMLImageElement).src, alt: t.getAttribute('alt') ?? '' });
          }
        }} />
      {big && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out" onClick={() => setBig(null)}>
          <img src={big.src} alt={big.alt} className="max-w-full max-h-full object-contain rounded shadow-2xl bg-white" />
          <button onClick={() => setBig(null)} title="Schliessen (Esc)"
            className={`absolute top-4 right-4 p-2 rounded-full ${isDark ? 'bg-white/10 text-white' : 'bg-white/90 text-black'}`}><X size={16} /></button>
        </div>
      )}
    </>
  );
}

/** Links from Markdown — for the ticket column of the list */
export function extractLinks(src: string): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  const re = /\[((?:\\.|[^\]])+)\]\((https?:[^)\s]+)\)|<(https?:[^>\s]+)>/g;
  for (let m; (m = re.exec(src ?? ''));) {
    if (m[2]) out.push({ text: m[1].replace(/\\(.)/g, '$1'), href: m[2] });
    else out.push({ text: m[3].replace(/^https?:\/\/[^/]+\/(browse\/)?/, ''), href: m[3] });
  }
  return out;
}

/** Markdown → plain text (for search and preview) */
export function plainText(src: string): string {
  return (src ?? '')
    .replace(/```[\s\S]*?```|~~~~[\s\S]*?~~~~/g, m => m.replace(/^(```|~~~~).*$/gm, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
