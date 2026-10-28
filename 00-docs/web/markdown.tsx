// Renders a markdown page: GitHub markdown (tables, alerts), raw HTML, heading anchors,
// syntax highlighting, links between pages and the images of src/docs.
import type {Element, ElementContent, Root} from 'hast';
import {toJsxRuntime} from 'hast-util-to-jsx-runtime';
import {toString} from 'hast-util-to-string';
import {createLowlight} from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import groovy from 'highlight.js/lib/languages/groovy';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import plaintext from 'highlight.js/lib/languages/plaintext';
import scala from 'highlight.js/lib/languages/scala';
import shell from 'highlight.js/lib/languages/shell';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type {ReactNode} from 'react';
import {Fragment, jsx, jsxs} from 'react/jsx-runtime';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import {unified} from 'unified';
import {visit} from 'unist-util-visit';
import {assetUrl, type Doc, docUrl, findDoc, resolvePath} from './docs';

export type TocEntry = {id: string; text: string; level: number};
/**
 * `problems`: links and images that point nowhere - the build fails on them (see entry-server.tsx).
 * `warnings`: code blocks in a language without highlighting.
 */
export type Rendered = {content: ReactNode; toc: TocEntry[]; problems: string[]; warnings: string[]};

const ALERTS: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

/** `> [!NOTE]` blockquotes (GitHub alerts) become callouts. */
const rehypeAlerts = () => (tree: Root) => {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'blockquote') return;
    const first = node.children.find((c): c is Element => c.type === 'element');
    const text = first?.tagName === 'p' ? first.children[0] : undefined;
    const match = text?.type === 'text' ? text.value.match(/^\[!(\w+)\]\s*/) : null;
    if (!first || !text || text.type !== 'text' || !match || !ALERTS[match[1]]) return;
    const kind = match[1].toLowerCase();
    text.value = text.value.slice(match[0].length);
    // the line break after `[!NOTE]` stays as a leading newline - drop it
    if (text.value === '' && first.children[1]?.type === 'text') {
      first.children[1].value = first.children[1].value.replace(/^\n/, '');
    }
    const title: Element = {
      type: 'element',
      tagName: 'p',
      properties: {className: ['callout-title']},
      children: [{type: 'text', value: ALERTS[match[1]]}],
    };
    node.tagName = 'div';
    node.properties = {className: ['callout', `callout-${kind}`]};
    node.children = [title, ...node.children] as ElementContent[];
  });
};

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

/** Links to other pages (`../x/y.md#anchor`) and files of src/docs get their site URLs. */
const rehypeLinks = (options: {dir: string; problems: string[]}) => (tree: Root) => {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'img' && typeof node.properties.src === 'string') {
      const src = node.properties.src;
      if (!isExternal(src)) {
        const url = assetUrl(resolvePath(options.dir, src));
        if (url) node.properties.src = url;
        else options.problems.push(`image ${src} - there is no such file`);
      }
      node.properties.loading = 'lazy';
    }
    if (node.tagName !== 'a' || typeof node.properties.href !== 'string') return;
    const href = node.properties.href;
    if (href.startsWith('#')) return;
    if (isExternal(href)) {
      node.properties.target = '_blank';
      node.properties.rel = ['noopener', 'noreferrer'];
      return;
    }
    // only the first # starts the anchor; a query string (x.md?a) is not supported - such a link is reported
    const cut = href.indexOf('#');
    const [path, hash] = cut < 0 ? [href, ''] : [href.slice(0, cut), href.slice(cut + 1)];
    const target = resolvePath(options.dir, path);
    const docId = target.replace(/\.md$/, '');
    if (path.endsWith('.md')) {
      if (findDoc(docId)) {
        node.properties.href = docUrl(docId) + (hash ? `#${hash}` : '');
        node.properties.dataInternal = 'true';
      } else options.problems.push(`link ${href} - there is no such page`);
    } else {
      const url = assetUrl(target);
      if (url) {
        node.properties.href = url + (hash ? `#${hash}` : '');
        node.properties.target = '_blank';
      } else options.problems.push(`link ${href} - there is no such file`);
    }
  });
};

/** A `#` link next to each heading, to copy the link to a chapter. */
const rehypeHeadingAnchors = () => (tree: Root) => {
  visit(tree, 'element', (node: Element) => {
    if (!/^h[2-4]$/.test(node.tagName) || typeof node.properties.id !== 'string') return;
    node.children.push({
      type: 'element',
      tagName: 'a',
      properties: {href: `#${node.properties.id}`, className: ['heading-anchor'], ariaHidden: 'true'},
      children: [{type: 'text', value: '#'}],
    });
  });
};

// only the languages the pages use - code blocks of other languages stay plain
const lowlight = createLowlight({bash, groovy, ini, javascript, json, plaintext, scala, shell, xml, yaml});
lowlight.registerAlias({ini: ['hocon', 'conf'], plaintext: ['log', 'mermaid', 'text'], shell: ['sh', 'console']});

/** Syntax highlighting of fenced code blocks (```scala …). */
const rehypeCodeHighlight = (options: {warnings: string[]}) => (tree: Root) => {
  visit(tree, 'element', (node: Element, _index, parent) => {
    if (node.tagName !== 'code' || (parent as Element | undefined)?.tagName !== 'pre') return;
    const classes = Array.isArray(node.properties.className) ? node.properties.className.map(String) : [];
    const lang = classes.find(c => c.startsWith('language-'))?.slice('language-'.length);
    node.properties.className = [...classes, 'hljs'];
    if (!lang) return;
    if (!lowlight.registered(lang)) {
      options.warnings.push(`code block in ${lang} - no highlighting (register it in markdown.tsx)`);
      return;
    }
    node.children = lowlight.highlight(lang, toString(node)).children as ElementContent[];
  });
};

const tocOf = (tree: Root): TocEntry[] => {
  const toc: TocEntry[] = [];
  visit(tree, 'element', (node: Element) => {
    if ((node.tagName === 'h2' || node.tagName === 'h3') && typeof node.properties.id === 'string') {
      toc.push({id: node.properties.id, text: toString(node), level: Number(node.tagName[1])});
    }
  });
  return toc;
};

const cache = new Map<string, Rendered>();

export function renderDoc(doc: Doc): Rendered {
  const cached = cache.get(doc.id);
  if (cached) return cached;
  const problems: string[] = [];
  const warnings: string[] = [];
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, {allowDangerousHtml: true})
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeAlerts)
    .use(rehypeLinks, {dir: doc.dir, problems})
    .use(rehypeCodeHighlight, {warnings});
  const tree = processor.runSync(processor.parse(doc.markdown)) as Root;
  const toc = tocOf(tree);
  rehypeHeadingAnchors()(tree);
  const rendered = {content: toJsxRuntime(tree, {Fragment, jsx, jsxs}), toc, problems, warnings};
  cache.set(doc.id, rendered);
  return rendered;
}
