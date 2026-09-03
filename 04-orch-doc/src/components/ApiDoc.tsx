// API documentation of one project — rendered from its OpenApi.yml in the
// app's own look and feel. The yml is the versioned one that `assemble.ts`
// takes from git-temp (`git show v<version>:…`), so what you read here is
// exactly the released API. Redoc stays available as an external link.
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, GitFork, Info, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parse } from 'yaml';
import { useDerived } from '../data';
import { Markdown } from '../markdown';
import { href, navigate } from '../router';
import type { CatalogKind, CompanyDocs, Project } from '../types';
import { Card, Empty, KindChip, PageTitle, ProjectChip, ReleaseStatus, cls } from '../ui';
import DiagramViewer from './DiagramViewer';

// ── OpenAPI types (only what we render) ───────────────────────────────────────
interface Schema {
  $ref?: string; type?: string; format?: string; title?: string; description?: string;
  properties?: Record<string, Schema>; required?: string[]; items?: Schema;
  /** a Scala tuple: `type: array` with one fixed schema per position (`Tuple3_String_String_String`) */
  prefixItems?: Schema[];
  enum?: unknown[]; oneOf?: Schema[]; anyOf?: Schema[]; allOf?: Schema[]; default?: unknown; example?: unknown;
}
interface Operation {
  method: string; path: string; tag: string; summary: string; operationId: string; description?: string;
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: Schema }[];
  requestBody?: { content?: Record<string, { schema?: Schema; example?: unknown; examples?: Record<string, { value: unknown }> }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema; example?: unknown; examples?: Record<string, { value: unknown }> }> }>;
}
interface Api {
  info: { title: string; version: string; summary?: string; description?: string; contact?: { url?: string } };
  operations: Operation[];
  schemas: Record<string, Schema>;
}

export function opKind(operationId: string): CatalogKind {
  if (/^(Process|Bpmn)/.test(operationId)) return 'Bpmn';
  if (operationId.startsWith('Init Worker')) return 'Worker';
  for (const k of ['Worker', 'UserTask', 'Signal', 'Message', 'Dmn', 'Timer'])
    if (operationId.startsWith(k)) return k as CatalogKind;
  return 'Other';
}

// operationIds repeat across the processes of one project (`Process start`,
// `Process variables`, `Init Worker`, …) — selecting by operationId alone would
// always hit the first process. Qualify ambiguous ids with their tag.
const opId = (o: Operation, all: Operation[]) =>
  all.some(x => x !== o && x.operationId === o.operationId) ? `${o.tag} · ${o.operationId}` : o.operationId;

// The generated markdown links point at the classic site — route them into the
// app instead: OpenApi pages become the API view (incl. #operation anchors),
// dependency pages become the dependency view.
const rewriteLinks = (md: string, company: string) => md
  .replace(/\(([^()\s]*?\/)?([\w-]+)\/OpenApi\.html(?:#operation\/([^)\s]+))?\)/g,
    (_, _pre, project, op) => `(#/${company}/api/${project}${op ? `?op=${op}` : ''})`)
  .replace(/\(([^()\s]*?\/)?dependencies\/([\w-]+)\.html\)/g,
    (_, _pre, project) => `(#/${company}/dependencies/${project})`);

// The generated project description (info.summary / info.description) is one long markdown:
// project text, `Created at …`, Postman instructions, "Package Configuration" (dependency links
// + the package.conf), the README (incl. an internal "Development" section), changelog, general
// variables and a `> Created with:` footer. Take it apart so the page can lay it out itself.
export function splitProjectInfo(md: string) {
  let rest = md;
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], '');
    return m;
  };
  // a generated `<details><summary><b><i>Label</i></b></summary><p>…</p></details>` block (the
  // summary may be wrapped over several lines) — its content, without the collapsible
  const takeDetails = (label: string) =>
    take(new RegExp(`<details>\\s*<summary>\\s*(?:<b>)?(?:<i>)?${label}(?:<\\/i>)?(?:<\\/b>)?\\s*<\\/summary>\\s*<p>([\\s\\S]*?)<\\/p>\\s*<\\/details>`))?.[1]?.trim();
  // the company's own gateway variant (`Valiant Postman Instructions`, see
  // ApiConfig.companyPostmanInstructions) — keeps its label, the plain one is matched below
  const companyPostmanMatch = take(/<details>\s*<summary>\s*(?:<b>)?(?:<i>)?([\w-]+ Postman Instructions)(?:<\/i>)?(?:<\/b>)?\s*<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/);
  const companyPostman = companyPostmanMatch ? { title: companyPostmanMatch[1].trim(), text: companyPostmanMatch[2].trim() } : undefined;
  const postman = takeDetails('Postman Instructions');
  const changelog = takeDetails('CHANGELOG\\.md');
  const generalVariables = takeDetails('General Variables');
  const pkg = take(/<details>\s*<summary>([^<\n]*package\.conf[^<\n]*)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/);
  take(/<details>\s*<summary><b>Development<\/b><\/summary>[\s\S]*?<\/details>/);
  // heading, "Check all dependency trees" line and the dependency link list — the page has chips
  take(/#\s*Package Configuration[^\n]*\n(?:\s*\*\*Check all dependency trees[^\n]*\n)?(?:\s*###\s*Dependencies:[^\n]*\n(?:\s*- [^\n]*\n?)*)?/);
  take(/\*\*See the \[Orchescala Documentation\][^\n]*\n?/);
  const createdAt = take(/Created at ([^\n]+)/)?.[1]?.trim();
  const createdWith = take(/>\s*Created with:\s*\n((?:>[^\n]*\n?)+)/)?.[1];
  const orchescala = createdWith?.match(/orchescala-api v?([\w.+-]+)/)?.[1];
  const company = createdWith?.match(/([\w-]+-orchescala)-api\s+([\w.+-]+)/);
  const versions = [orchescala && `orchescala v${orchescala}`, company && `${company[1]} ${company[2]}`]
    .filter(Boolean).join(' · ');
  rest = rest.replace(/\n{3,}/g, '\n\n').trim();
  // the project text: everything up to the first section (README heading / details block)
  const cut = ['<details>', '\n#'].map(m => rest.indexOf(m)).filter(i => i >= 0)
    .reduce((a, b) => Math.min(a, b), rest.length);
  return {
    intro: rest.slice(0, cut).trim(),
    rest: rest.slice(cut).trim(),
    createdAt,
    versions,
    packageConf: pkg ? { file: pkg[1].trim(), text: pkg[2].trim() } : undefined,
    changelog,
    generalVariables,
    postman,
    companyPostman,
  };
}

// Redoc renders the diagrams with an HTML/JS hack in the description — we strip
// it (incl. the download line) and render the referenced .bpmn/.dmn ourselves.
const cleanDescription = (md: string) => md
  // the generator stamps `Created at 7/16/26, 1:35 PM` (en-US) — show it Swiss style
  .replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}), (\d{1,2}):(\d{2})(?::\d{2})?\s(AM|PM)/g,
    (_, m, d, y, h, min, ap) => {
      const hh = (Number(h) % 12) + (ap === 'PM' ? 12 : 0);
      return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y.length === 2 ? `20${y}` : y}, ${String(hh).padStart(2, '0')}:${min}`;
    })
  .replace(/<div class="diagramCanvas">[\s\S]*?<\/div>\s*<\/div>/g, '')
  .replace(/<div>\s*<button[\s\S]*?<\/div>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '')
  .replace(/^Download: \[[^\]]+\]\(diagrams\/[^)]+\)\s*$/gm, '')
  .replace(/\n{3,}/g, '\n\n');

const diagramFiles = (md: string | undefined) =>
  [...new Set([...(md ?? '').matchAll(/\(diagrams\/([^)\s]+)\)/g)].map(m => m[1]))];

function useApi(url: string) {
  const [state, setState] = useState<{ api?: Api; error?: string }>({});
  useEffect(() => {
    let alive = true;
    setState({});
    fetch(url, { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => {
        const doc = parse(text) as { info: Api['info']; paths: Record<string, Record<string, Omit<Operation, 'method' | 'path' | 'tag'>>>; components?: { schemas?: Record<string, Schema> } };
        const operations: Operation[] = Object.entries(doc.paths ?? {}).flatMap(([path, methods]) =>
          Object.entries(methods).map(([method, op]) => ({
            ...op, method: method.toUpperCase(), path,
            tag: (op as { tags?: string[] }).tags?.[0] ?? 'General',
            summary: op.summary ?? op.operationId ?? path,
            operationId: op.operationId ?? `${method} ${path}`,
          })));
        if (!doc || typeof doc !== 'object' || !doc.info) throw new Error('not a valid OpenApi.yml');
        if (alive) setState({ api: { info: doc.info, operations, schemas: doc.components?.schemas ?? {} } });
      })
      .catch(e => alive && setState({ error: String(e.message ?? e) }));
    return () => { alive = false; };
  }, [url]);
  return state;
}

// ── schema tree ───────────────────────────────────────────────────────────────
const deref = (s: Schema | undefined, schemas: Record<string, Schema>): { s: Schema; refName?: string } => {
  if (s?.$ref) {
    const name = s.$ref.split('/').pop()!;
    return { s: schemas[name] ?? {}, refName: name };
  }
  return { s: s ?? {} };
};

const typeLabel = (s: Schema, refName?: string, schemas?: Record<string, Schema>): string => {
  // a Scala tuple (`Tuple3_String_String_String`, one schema per position) reads as `(string, string, string)`
  if (s.prefixItems && schemas)
    return `(${s.prefixItems.map(p => { const d = deref(p, schemas); return typeLabel(d.s, d.refName, schemas); }).join(', ')})`;
  // `In4` / `Out9` / `InitIn2` are the generator's de-duplicated names for the domain classes — show the class
  if (refName) return refName.replace(/^((?:.*[.> ])?(?:In|Out|InitIn))\d+$/, '$1');
  if (s.enum) return 'enum';
  if (s.type === 'array') return `array`;
  if (s.oneOf || s.anyOf) return 'one of';
  return [s.type ?? 'object', s.format && `(${s.format})`].filter(Boolean).join(' ');
};

/** "expand all" / "collapse all" of a SchemaTree — a new `gen` applies `open` to every node once */
type AllState = { open: boolean; gen: number };

function SchemaNode({ name, schema, schemas, required, isDark, depth, seen, defaultOpen, headless, all }: {
  name?: string; schema: Schema; schemas: Record<string, Schema>; required?: boolean;
  isDark: boolean; depth: number; seen: string[];
  /** root only: start collapsed (the In/Out sections show the class, its fields on demand) */
  defaultOpen?: boolean;
  /** the selected `oneOf` variant: only its fields, no row of its own (the chip already names it) */
  headless?: boolean;
  all?: AllState;
}) {
  const c = cls(isDark);
  const { s, refName } = deref(schema, schemas);
  const cyclic = refName ? seen.includes(refName) : false;
  const nextSeen = refName ? [...seen, refName] : seen;
  const { s: item, refName: itemRef } = deref(s.items, schemas);
  const variants = s.oneOf ?? s.anyOf;
  const props = s.type === 'array' ? item.properties : s.properties;
  const propRequired = (s.type === 'array' ? item.required : s.required) ?? [];
  // a tuple's positions only get rows of their own if one of them is a class (has fields)
  const tuple = s.prefixItems ?? item.prefixItems;
  const tupleRows = !!tuple?.some(p => !!deref(p, schemas).s.properties);
  const hasChildren = !cyclic && (!!props || !!variants || tupleRows
    || (s.type === 'array' && !!itemRef && !item.properties && !item.prefixItems));
  const [open, setOpen] = useState(defaultOpen ?? depth < 2);
  // expand all / collapse all from the tree's toolbar — every node follows, then toggles freely again
  useEffect(() => { if (all) setOpen(all.open); }, [all?.gen]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = s.prefixItems ? typeLabel(s, refName, schemas)
    : s.type === 'array' ? `array of ${typeLabel(item, itemRef, schemas)}` : typeLabel(s, refName, schemas);
  // a tuple's title is the generated `Tuple3_String_String_String` — the label already says it better
  // the title is the short class name — nothing to add when the label already ends with it
  // (`GetClientSearch.Out` / `Out`), and a tuple's title is the generated `Tuple3_…`
  const titleShown = s.title && !s.prefixItems && s.title !== label && s.title !== label.replace(/^.*[.> ]/, '') ? s.title : undefined;
  const descr = (s.description ?? titleShown)?.trim();
  // a long comment (mock instructions with a JSON example, …) shows its first line only — the
  // rest opens on the info icon, rendered as markdown so code blocks and lists come out right
  const descrLines = (descr ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const descrFirst = descrLines[0];
  const descrMore = descrLines.length > 1;
  const [descrOpen, setDescrOpen] = useState(false);
  // A Scala enum / sealed trait becomes a `oneOf` of de-duplicated components (`companiesAndOther1`,
  // title `companiesAndOther`) — shown like Redoc: the variant names in the row, one chip per variant,
  // and the fields of the chosen one directly underneath.
  const variantName = (v: Schema) => {
    const d = deref(v, schemas);
    return d.s.title ?? d.refName?.replace(/\d+$/, '') ?? typeLabel(d.s);
  };
  const [variant, setVariant] = useState(0);
  const variantDesc = variants && deref(variants[variant], schemas).s.description;
  const children = hasChildren && (
    <div className={headless ? '' : 'ml-1'}>
      {props && Object.entries(props).map(([n, ps]) => (
        <SchemaNode key={n} name={n} schema={ps} schemas={schemas} required={propRequired.includes(n)}
          isDark={isDark} depth={depth + 1} seen={nextSeen} all={all} />
      ))}
      {variants && (
        <div className={`border-l ${c.border} pl-3`}>
          <div className="flex flex-wrap items-center gap-1 py-1">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${c.muted} mr-1`}>One of</span>
            {variants.map((v, i) => (
              <button key={i} onClick={() => setVariant(i)}
                className={`px-1.5 py-0.5 rounded border text-[10px] ${i === variant
                  ? (isDark ? 'bg-sky-300 border-sky-300 text-slate-900 font-semibold' : 'bg-sky-800 border-sky-800 text-white font-semibold')
                  : `${c.border} ${c.text} ${c.hover}`}`}>
                {variantName(v)}
              </button>
            ))}
          </div>
          {variantDesc && <div className={`text-[11px] ${c.muted2} whitespace-pre-line mb-1`}>{variantDesc.trim()}</div>}
          <SchemaNode key={variant} schema={variants[variant]} schemas={schemas} isDark={isDark} depth={depth} seen={nextSeen} headless all={all} />
        </div>
      )}
      {tupleRows && tuple!.map((p, i) => (
        <SchemaNode key={i} name={`_${i + 1}`} schema={p} schemas={schemas} isDark={isDark} depth={depth + 1} seen={nextSeen} all={all} />
      ))}
      {s.type === 'array' && !!itemRef && !item.properties && !item.prefixItems &&
        <SchemaNode schema={s.items!} schemas={schemas} isDark={isDark} depth={depth + 1} seen={nextSeen} all={all} />}
    </div>
  );
  if (headless) return <>{children}</>;
  return (
    <div className={depth ? `border-l ${c.border} pl-3` : ''}>
      <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5 text-[11px] ${hasChildren ? 'cursor-pointer select-none' : ''}`}
        onClick={hasChildren ? () => setOpen(o => !o) : undefined}>
        {hasChildren
          ? (open ? <ChevronDown size={10} className={`${c.muted} translate-y-0.5 flex-shrink-0`} /> : <ChevronRight size={10} className={`${c.muted} translate-y-0.5 flex-shrink-0`} />)
          : <span className="w-[10px] flex-shrink-0" />}
        {name && <span className={`font-semibold ${c.text}`}>{name}{required && <span className={isDark ? 'text-rose-400' : 'text-rose-600'}>*</span>}</span>}
        <span className={`${isDark ? 'text-sky-300' : 'text-sky-800'}`}>{label}</span>
        {cyclic && <span className={`italic ${c.muted}`}>(recursive)</span>}
        {s.enum && (
          // a value enum (`ClientType`: companiesAndOther | privateIndividual | …) — same "One of" +
          // boxes as the class variants above, just nothing to open
          <span className="inline-flex flex-wrap items-center gap-1 min-w-0">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${c.muted} mr-1`}>One of</span>
            {s.enum.map((v, i) => (
              <span key={i} className={`px-1.5 py-0.5 rounded border text-[10px] ${c.border} ${c.text}`}>
                {typeof v === 'string' ? v : JSON.stringify(v)}
              </span>
            ))}
          </span>
        )}
        {s.default !== undefined && <span className={c.muted}>default: {JSON.stringify(s.default)}</span>}
        {descrFirst && descr !== label && (
          <span className={`${c.muted2} min-w-0 break-words inline-flex items-baseline gap-1`}>
            {descrFirst}
            {descrMore && (
              <button onClick={e => { e.stopPropagation(); setDescrOpen(o => !o); }}
                title={descrOpen ? 'Hide the full comment' : 'Show the full comment'}
                className={`translate-y-0.5 rounded ${descrOpen ? (isDark ? 'text-sky-300' : 'text-sky-800') : c.muted} ${c.hover}`}>
                <Info size={11} />
              </button>
            )}
          </span>
        )}
      </div>
      {descrOpen && descr && (
        <div className={`ml-4 my-1 pl-2 border-l ${c.border}`}>
          <Markdown text={descr} className={`text-[11px] ${c.muted2}`} />
        </div>
      )}
      {open && children}
    </div>
  );
}

/** One In / Out object: the schema tree with an "expand all" / "collapse all" toolbar at its right */
function SchemaTree({ schema, schemas, isDark }: { schema: Schema; schemas: Record<string, Schema>; isDark: boolean }) {
  const c = cls(isDark);
  const [all, setAll] = useState<AllState>();
  const set = (open: boolean) => setAll(a => ({ open, gen: (a?.gen ?? 0) + 1 }));
  const btn = `p-0.5 rounded ${c.muted} ${c.hover}`;
  return (
    <div className="relative">
      <div className="absolute right-0 top-0 flex items-center gap-0.5">
        <button onClick={() => set(true)} title="Expand all" className={btn}><ChevronsUpDown size={12} /></button>
        <button onClick={() => set(false)} title="Collapse all" className={btn}><ChevronsDownUp size={12} /></button>
      </div>
      <div className="pr-12">
        <SchemaNode schema={schema} schemas={schemas} isDark={isDark} depth={0} seen={[]} defaultOpen={false} all={all} />
      </div>
    </div>
  );
}

function ExampleBlock({ title, value, isDark }: { title: string; value: unknown; isDark: boolean }) {
  const c = cls(isDark);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);
  const copy = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div className={`rounded border ${c.border} overflow-hidden`}>
      <div className={`flex items-center text-[10px] ${c.muted2}`}>
        <button onClick={() => setOpen(o => !o)} className={`flex-1 flex items-center gap-1.5 px-2 py-1 text-left ${c.hover}`}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}{title}
        </button>
        {/* copy the JSON - e.g. into Postman or a test - without opening the block */}
        <button onClick={copy} title={copied ? 'Copied' : 'Copy JSON'}
          className={`px-2 py-1 ${c.hover} ${copied ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : ''}`}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
      {open && <pre className={`text-[10px] leading-relaxed p-2 overflow-x-auto max-h-96 ${isDark ? 'bg-white/3' : 'bg-black/3'}`}>
        {text}</pre>}
    </div>
  );
}

/** A collapsed-by-default section — "Technical Request", "Examples". */
function Panel({ title, isDark, children, className }: { title: string; isDark: boolean; children: ReactNode; className?: string }) {
  const c = cls(isDark);
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded border ${c.border} overflow-hidden ${className ?? ''}`}>
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${c.muted2} ${c.hover}`}>
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}{title}
      </button>
      {open && <div className="p-2">{children}</div>}
    </div>
  );
}

const METHOD_COLOR: Record<string, { dark: string; light: string }> = {
  GET: { dark: 'bg-emerald-500/15 text-emerald-300', light: 'bg-emerald-50 text-emerald-700' },
  POST: { dark: 'bg-sky-500/15 text-sky-300', light: 'bg-sky-50 text-sky-700' },
  PUT: { dark: 'bg-amber-500/15 text-amber-300', light: 'bg-amber-50 text-amber-700' },
  DELETE: { dark: 'bg-rose-500/15 text-rose-300', light: 'bg-rose-50 text-rose-700' },
};

function OperationView({ op, api, isDark, base, rewrite }: { op: Operation; api: Api; isDark: boolean; base: string; rewrite: (md: string) => string }) {
  const c = cls(isDark);
  const mc = METHOD_COLOR[op.method] ?? METHOD_COLOR.POST;
  const bodies = (content?: Record<string, { schema?: Schema; example?: unknown; examples?: Record<string, { value: unknown }> }>) =>
    Object.entries(content ?? {}).map(([mime, b]) => ({ mime, ...b }));
  const reqs = bodies(op.requestBody?.content);
  const resps = Object.entries(op.responses ?? {}).flatMap(([code, r]) =>
    bodies(r.content).map(b => ({ code, description: r.description, ...b })));
  // the class behind a body: `In`, `Out`, `ProcessInfo`, … — what the technical panel names
  const className = (s?: Schema) => { const d = deref(s, api.schemas); return typeLabel(d.s, d.refName, api.schemas); };
  const examplesOf = (b: { example?: unknown; examples?: Record<string, { value: unknown }> }) => [
    ...(b.example !== undefined ? [{ title: 'Example', value: b.example }] : []),
    ...Object.entries(b.examples ?? {}).map(([n, e]) => ({ title: n, value: e.value })),
  ];
  const codeColor = (code: string) =>
    Number(code) < 400 ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : (isDark ? 'text-rose-300' : 'text-rose-700');
  const h3 = `text-[10px] font-bold uppercase tracking-widest mb-1.5 ${c.muted}`;
  // A body is shown in exactly ONE place: the domain objects `In` / `Out` get their own sections,
  // everything else (`ProcessInfo`, `MockedServiceResponse`, …) is technical and lives in the
  // Technical Request panel — rendered the same way there.
  // The generator de-duplicates equally named components with a number (`In4`, `Out9`) — those
  // are still the domain In / Out (their schema title says so), so the number does not count.
  // InitIn is the Init Worker's domain result (the enriched In) — it belongs to Out, not to the
  // technical panel.
  const isDomain = (s?: Schema) => {
    const { s: d, refName } = deref(s, api.schemas);
    return /(^|[.> ])(In|Out|InitIn)\d*$/.test(refName ?? '') || /^(In|Out|InitIn)$/.test(d.title ?? '');
  };
  const domainReqs = reqs.filter(b => isDomain(b.schema)), techReqs = reqs.filter(b => !isDomain(b.schema));
  const domainResps = resps.filter(b => isDomain(b.schema)), techResps = resps.filter(b => !isDomain(b.schema));
  const domainBodies = [...domainReqs, ...domainResps];
  // The class is named from the task's point of view, the HTTP body from the caller's: a user
  // task's `In` (what the form shows) is the RESPONSE of `variables`, its `Out` (what the user
  // enters) is the REQUEST of `complete`. For user tasks the heading therefore follows the
  // caller (In = sent, Out = returned) and the class stays visible as the root row underneath;
  // elsewhere heading and class agree and the class is the heading.
  const isUserTask = opKind(op.operationId) === 'UserTask';
  const note = (text: string) => <span className={`font-normal ${c.muted}`}>{text}</span>;
  const domainTitle = (cls: string, isResponse: boolean) => {
    if (isUserTask)
      return isResponse
        ? <>Out{note('the variables shown in the form of this UserTask — returned by this call')}</>
        : <>In{note('the values entered in the form of this UserTask — sent with this call')}</>;
    // the heading is the short class (`In`), the owner (`OpenMkkV1.In`) shows in the root row below
    const short = cls.replace(/^.*[.> ]/, '');
    const isIn = /^In\d*$/.test(short), isOut = /^Out\d*$/.test(short);
    return isResponse && isIn ? <>{short}{note('returned by this call')}</>
      : !isResponse && isOut ? <>{short}{note('sent with this call')}</>
      : short;
  };
  // "No In" / "No Out": by direction for user tasks, by class everywhere else (InitIn is the
  // Init Worker's Out)
  const hasIn = isUserTask ? domainReqs.length > 0 : domainBodies.some(b => /(^|[.> ])In$/.test(className(b.schema)));
  const hasOut = isUserTask ? domainResps.length > 0 : domainBodies.some(b => /(^|[.> ])(Out|InitIn)$/.test(className(b.schema)));
  // section headings look like the process names in the navigation
  const hSection = `flex flex-wrap items-baseline gap-x-2 text-[11.5px] font-bold mb-1.5 pb-0.5 border-b ${c.border} ${c.text}`;
  // a body: the class, its fields on demand; one example directly, several in a collapsed panel
  const body = (title: ReactNode, key: string, b: { mime: string; schema?: Schema; description?: string; example?: unknown; examples?: Record<string, { value: unknown }> }, meta = false) => {
    const examples = examplesOf(b);
    return (
      <div key={key} className="mb-4">
        <h3 className={hSection}>
          {title}
          {meta && <span className={`font-normal ${isDark ? 'text-sky-300' : 'text-sky-800'}`}>{className(b.schema)}</span>}
          {meta && <span className={`font-normal ${c.muted}`}>{b.mime}</span>}
          {meta && b.description && <span className={`font-normal ${c.muted2}`}>{b.description}</span>}
        </h3>
        {b.schema && <SchemaTree schema={b.schema} schemas={api.schemas} isDark={isDark} />}
        {examples.length === 1 && (
          // a single example needs no name of its own (`valiant-bpmn-productGroups`) — it is THE example
          <div className="mt-2"><ExampleBlock title="Example" value={examples[0].value} isDark={isDark} /></div>
        )}
        {examples.length > 1 && (
          <Panel title={`Examples (${examples.length})`} isDark={isDark} className="mt-2">
            <div className="space-y-1">
              {examples.map(e => <ExampleBlock key={e.title} title={e.title} value={e.value} isDark={isDark} />)}
            </div>
          </Panel>
        )}
      </div>
    );
  };
  const responseTitle = (b: { code: string }, many: boolean) =>
    <>Response Body{many && <span className={`ml-1 ${codeColor(b.code)}`}>{b.code}</span>}</>;
  // an absent body still gets its place — so the reader sees it is absent, not forgotten
  const none = (key: string, title: string) => (
    <div key={key} className="mb-4">
      <h3 className={`${hSection} ${c.muted}`}>{title}</h3>
    </div>
  );
  // a domain body is shown in its In / Out section above — the technical panel only points to it
  const refLine = (key: string, title: ReactNode, b: { schema?: Schema }) => (
    <div key={key} className="mb-4">
      <h3 className={hSection}>
        {title}:<span className={`font-normal ${isDark ? 'text-sky-300' : 'text-sky-800'}`}>{className(b.schema)}</span>
      </h3>
    </div>
  );
  return (
    <div>
      <h2 className={`text-sm font-bold mb-3 ${c.text}`}>{op.summary}</h2>
      {op.description && <Markdown text={rewrite(cleanDescription(op.description))} base={base} className="mb-4" />}
      {diagramFiles(op.description).map(f => (
        <DiagramViewer key={f} url={`${base}diagrams/${f}`} name={f} isDark={isDark} />
      ))}

      {/* the heading is the class itself (In / Out / InitIn) — an Init Worker answers with
          InitIn; user tasks are the exception (see domainTitle). Request (In) first, response
          (Out) second, an absent side gets its "No In" / "No Out" in that same place. */}
      {domainReqs.map(b => body(domainTitle(className(b.schema), false), `in-${b.mime}`, b))}
      {!hasIn && none('no-in', 'No In')}
      {domainResps.map(b => body(
        <>{domainTitle(className(b.schema), true)}{domainResps.length > 1 && <span className={`ml-1 ${codeColor(b.code)}`}>{b.code}</span>}</>,
        `out-${b.code}-${b.mime}`, b))}
      {!hasOut && none('no-out', 'No Out')}

      {/* purely technical, at the end: path, parameters, and the non-domain bodies */}
      <Panel title="Technical Request" isDark={isDark} className="mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isDark ? mc.dark : mc.light}`}>{op.method}</span>
          <code className={`text-[11px] ${c.muted2} break-all`}>{op.path}</code>
        </div>
        {op.parameters?.length ? (
          <div className="mb-4">
            <h3 className={h3}>Parameters</h3>
            {op.parameters.map(p => (
              <div key={p.name} className="flex items-baseline gap-2 text-[11px] py-0.5">
                <span className={`font-semibold ${c.text}`}>{p.name}{p.required && <span className={isDark ? 'text-rose-400' : 'text-rose-600'}>*</span>}</span>
                <span className={c.muted}>{p.in}</span>
                <span className={isDark ? 'text-sky-300' : 'text-sky-800'}>{deref(p.schema, api.schemas).s.type ?? ''}</span>
                {p.description && <span className={c.muted2}>{p.description}</span>}
              </div>
            ))}
          </div>
        ) : null}
        {techReqs.length
          ? techReqs.map(b => body('Request Body', `req-${b.mime}`, b, true))
          : domainReqs.length
            ? domainReqs.map(b => refLine(`ref-req-${b.mime}`, 'Request Body', b))
            : none('no-req', 'No Request Body')}
        {techResps.length
          ? techResps.map(b => body(responseTitle(b, resps.length > 1), `res-${b.code}-${b.mime}`, b, true))
          : domainResps.length
            ? domainResps.map(b => refLine(`ref-res-${b.code}-${b.mime}`, responseTitle(b, resps.length > 1), b))
            : none('no-res', 'No Response Body')}
      </Panel>
    </div>
  );
}


// ── project overview panel — the same infos on every API page ────────────────
function ProjectPanel({ docs, api, p, project, base, isDark, standalone, rewrite }: {
  docs: CompanyDocs; api: Api; p?: Project; project: string; base: string; isDark: boolean;
  standalone?: boolean; rewrite: (md: string) => string;
}) {
  const c = cls(isDark);
  const { byName, dependsOn, usedBy } = useDerived(docs);

  // the generated summary, taken apart: project text first, the technical parts each in their
  // own place (see splitProjectInfo) — nothing hides behind a "generated details" toggle anymore
  const summary = api.info.summary ?? api.info.description ?? '';
  const info = useMemo(() => splitProjectInfo(summary), [summary]);
  const intro = cleanDescription(info.intro);
  const rest = info.rest;
  const createdAt = info.createdAt && cleanDescription(`Created at ${info.createdAt}`).replace(/^Created at /, '');

  const dep = docs.dependencies.find(d => d.project === project);
  const status = docs.releaseTables.flatMap(t => t.rows).find(r => r.project === project)?.status;
  const chips = (list?: { project: string; version?: string }[]) =>
    !list?.length ? <Empty isDark={isDark}>none</Empty> :
    <div className="flex flex-wrap gap-1">
      {[...list].sort((a, b) => a.project.localeCompare(b.project)).map(d => (
        <ProjectChip key={d.project} name={d.project} version={d.version} color={byName.get(d.project)?.color}
          isDark={isDark} href={href.api(docs.company, d.project)} title={`${d.project} — API documentation`} />
      ))}
    </div>;

  return (
    <Card isDark={isDark} className="p-4 mb-4">
      <div className={`grid gap-4 ${standalone ? '' : 'lg:grid-cols-[1fr_22rem]'}`}>
        {/* infos */}
        <div className="min-w-0">
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] ${c.muted2}`}>
            {p?.group && <span>group <b className={c.text}>{p.group}</b></span>}
            {p?.version && <span>bpmn <b className={c.text}>{p.version}</b></span>}
            {p?.workerVersion && <span>worker <b className={c.text}>{p.workerVersion}</b></span>}
            {status && <ReleaseStatus status={status} isDark={isDark} />}
            {dep?.preview && <span className="italic">preview to the next release</span>}
            {createdAt && <span>created <b className={c.text}>{createdAt}</b>{info.versions && <span className={c.muted}> ({info.versions})</span>}</span>}
            {!standalone && (
              <span className="flex items-center gap-2 ml-auto">
                {p?.hasDependencies && (
                  <a href={href.dependencies(docs.company, project)} className={`flex items-center gap-1 ${c.link}`}>
                    <GitFork size={10} /> Dependency graph</a>
                )}
                <a href={href.release(docs.company)} className={c.link}>Release {docs.release.tag}</a>
              </span>
            )}
          </div>
          {/* the project description — right under the version line */}
          {intro && <Markdown text={rewrite(intro)} base={base} className="mt-3" />}
          {/* the rest of the generated text (README, changelog, general variables) — top level */}
          {rest && <Markdown text={rewrite(cleanDescription(rest))} base={base} className="mt-3" />}
          {info.changelog && (
            <Panel title="CHANGELOG.md" isDark={isDark} className="mt-3">
              <Markdown text={rewrite(cleanDescription(info.changelog))} base={base} />
            </Panel>
          )}
          {info.generalVariables && (
            <Panel title="General Variables" isDark={isDark} className="mt-3">
              <Markdown text={rewrite(cleanDescription(info.generalVariables))} base={base} />
            </Panel>
          )}
          {info.packageConf && (
            <Panel title={`Project Configuration (${info.packageConf.file})`} isDark={isDark} className="mt-3">
              <Markdown text={info.packageConf.text} base={base} />
            </Panel>
          )}
          {info.postman && (
            <Panel title="Postman Instructions" isDark={isDark} className="mt-3">
              <Markdown text={info.postman} base={base} />
            </Panel>
          )}
          {info.companyPostman && (
            <Panel title={info.companyPostman.title} isDark={isDark} className="mt-3">
              <Markdown text={info.companyPostman.text} base={base} />
            </Panel>
          )}
        </div>
        {/* dependencies */}
        {!standalone && <div className={`lg:border-l lg:pl-4 ${c.border}`}>
          <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest mb-1.5 ${c.muted}`}>
            <ArrowDownToLine size={10} /> depends on
          </div>
          {chips(dep?.dependsOn ?? dependsOn.get(project))}
          <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest mt-3 mb-1.5 ${c.muted}`}>
            <ArrowUpFromLine size={10} /> used by
          </div>
          {chips(usedBy.get(project))}
        </div>}
      </div>
    </Card>
  );
}

// ── the page ──────────────────────────────────────────────────────────────────
export default function ApiDoc({ docs, isDark, project, op, standalone, onSelectOp }: {
  docs: CompanyDocs; isDark: boolean; project: string; op?: string;
  /** no company data around — hide sidebar links, dependencies and link rewriting */
  standalone?: boolean;
  /** override how an operation is selected (standalone: hash instead of router) */
  onSelectOp?: (operationId: string) => void;
}) {
  const c = cls(isDark);
  const { byName } = useDerived(docs);
  const p = byName.get(project);
  // apiDocUrl is relative to the company folder — the app itself lives one level up. The yml is
  // the html's namesake: `OpenApi.html` -> `OpenApi.yml`, `PostmanOpenApi.html` (the company
  // gateway's variant, standalone only) -> `PostmanOpenApi.yml`.
  const htmlName = p?.apiDocUrl.split('/').pop() ?? 'OpenApi.html';
  const base = `${docs.company}/${p?.apiDocUrl.replace(/[^/]*\.html$/, '') ?? `${project}/`}`;
  const ymlName = /\.html$/.test(htmlName) ? htmlName.replace(/\.html$/, '.yml') : 'OpenApi.yml';
  const { api, error } = useApi(`${base}${ymlName}`);
  const rewrite = standalone ? (md: string) => md : (md: string) => rewriteLinks(md, docs.company);
  const selectOp = onSelectOp ?? ((id: string) => navigate(href.api(docs.company, project, id)));
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => {
    if (!api) return undefined;
    const all = api.operations;
    const exact = all.find(o => opId(o, all) === op) ?? all.find(o => o.operationId === op);
    if (exact || !op) return exact ?? all[0];
    // catalog anchors like `Bpmn: openMkkV1` name the process, not an operationId
    const name = op.split(': ').pop()!;
    return all.find(o => o.path.includes(name) || o.operationId.endsWith(name)) ?? all[0];
  }, [api, op]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (error) return (
    <div>
      <PageTitle isDark={isDark} title={project} />
      <Empty isDark={isDark}>OpenApi.yml not found ({error}){standalone
        ? <> — the page must be served over http next to its OpenApi.yml (a <code>file://</code> page cannot load it).</>
        : <> — assemble the site with <code>npm run site</code>.</>}</Empty>
    </div>
  );
  if (!api) return <p className={`text-[11px] ${c.muted}`}>Loading API …</p>;

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const ops = api.operations.filter(o => terms.every(t => o.operationId.toLowerCase().includes(t) || o.tag.toLowerCase().includes(t)));
  const tags = [...new Set(ops.map(o => o.tag))];

  return (
    <div>
      <PageTitle isDark={isDark}
        title={<span className="flex items-center gap-3">{api.info.title}
          <span className={`text-[11px] font-normal px-1.5 py-0.5 rounded border ${c.border2} ${c.muted2}`} title="Version of the released OpenApi.yml (git tag)">v{api.info.version}</span>
        </span>}
        meta={<>
          {!standalone && p && <ProjectChip name={p.name} color={p.color} isDark={isDark} href={p.hasDependencies ? href.dependencies(docs.company, p.name) : undefined} />}
          <span>{api.operations.length} operations</span>
        </>} />

      <ProjectPanel docs={docs} api={api} p={p} project={project} base={base} isDark={isDark} standalone={standalone} rewrite={rewrite} />

      <div className="grid md:grid-cols-[20rem_1fr] gap-4 items-start">
        {/* operation list */}
        <Card isDark={isDark} className="p-2 md:sticky md:top-[52px] md:max-h-[calc(100vh-70px)] flex flex-col">
          <div className="relative mb-2 flex-shrink-0">
            <Search size={11} className={`absolute left-2 top-1/2 -translate-y-1/2 ${c.muted}`} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter …"
              className={`w-full text-[11px] pl-6 pr-6 py-1 rounded border outline-none ${c.input}`} />
            {q && <button onClick={() => setQ('')} className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${c.muted}`}><X size={10} /></button>}
          </div>
          <div ref={listRef} className="overflow-y-auto min-h-0">
            {tags.map(tag => (
              <div key={tag} className="mb-2">
                <div className={`px-1 text-[11.5px] font-bold mb-1 pb-0.5 border-b ${c.border} ${c.text}`}>{tag}</div>
                {ops.filter(o => o.tag === tag).map(o => (
                  <button key={opId(o, api.operations)} data-active={o === selected}
                    onClick={() => selectOp(opId(o, api.operations))}
                    className={`w-full flex items-center gap-1.5 text-left rounded px-1.5 py-1 text-[10.5px] transition-colors ${
                      o === selected ? (isDark ? 'bg-white/10 text-white' : 'bg-black/8 text-black') : `${c.muted2} ${c.hover}`}`}>
                    <KindChip kind={opKind(o.operationId)} isDark={isDark} />
                    <span className="truncate">{o.summary
                      .replace(/^UserTask (variables|complete): (.*)$/, '$1: $2')
                      .replace(/^(Worker|Signal|Message|Dmn|Timer|Bpmn): /, '')}</span>
                  </button>
                ))}
              </div>
            ))}
            {!ops.length && <Empty isDark={isDark}>Nothing matches.</Empty>}
          </div>
        </Card>

        {/* detail */}
        <div className="min-w-0">
          <Card isDark={isDark} className="p-4">
            {selected ? <OperationView op={selected} api={api} isDark={isDark} base={base} rewrite={rewrite} /> : <Empty isDark={isDark}>No operation.</Empty>}
          </Card>
        </div>
      </div>
    </div>
  );
}
