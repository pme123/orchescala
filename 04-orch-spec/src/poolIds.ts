// Pool and process have the same name.
//
// In the diagram one names the pool — the process behind it keeps the ID that
// the modeler gave it (`Process_0jx2w61`). But everything hangs on it:
// topics, the assignment to the domain, project and file name. Hence the
// convention of the templates applies:
//
//   Pool      name = <Name>          id = <Name>-participant
//   Process   name = <Name>          id = <Name>
//
// The name of the pool is decisive — but only if it works as an ID
// (`globex-savings-openSavingsV1`). If the diagram has no pool (that is how
// the Camunda Modeler creates a C8 process) or the pool carries a
// business title with spaces, the name of the process applies; if that does not work
// either, nothing is aligned.
//
// The **process ID** is a contract (deployment, topics, callers) — it
// follows the name only if it is still the modeler's (`Process_…`) or
// someone has just changed the name (`renameProcess`). Otherwise merely
// opening would rename a process whose pool is named slightly differently.
//
// Renaming happens wherever the old ID appears **as a whole value**
// (`processRef`, `bpmnElement`, message flows, the init worker, whose
// topic is the process ID) or as FEEL text `="<ID>"` (Camunda 8, e.g.
// `processDefinitionKey` on the process event) — names excepted.

const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};

function descendants(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => { out.push(el); for (const k of Array.from(el.children)) walk(k); };
  walk(root);
  return out;
}

/** usable as a BPMN ID (NCName without colon) */
export const isIdLike = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s);

export const participantIdOf = (name: string): string => `${name}-participant`;

/** ID assigned by the modeler (`Process_0jx2w61`) — not yet chosen by anyone */
const GENERATED = /^Process_[A-Za-z0-9]+$/;

/** The names the processes follow — if they change, a rename happens */
export function poolNames(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length) return '';
  const all = descendants(root);
  return all.filter(e => local(e) === 'process').map(proc => {
    const part = all.find(e => local(e) === 'participant' && e.getAttribute('processRef') === proc.getAttribute('id'));
    return `${part?.getAttribute('name') ?? ''}/${proc.getAttribute('name') ?? ''}`;
  }).join('|');
}

export interface PoolAlignment {
  xml: string;
  /** what was renamed: old → new */
  renamed: Array<[string, string]>;
}

/**
 * Process ID and name after the name of the pool, the pool ID with
 * `-participant` appended. If nothing changes, the XML comes back
 * unchanged (the same string).
 */
export function alignPoolIds(xml: string, opts: { renameProcess?: boolean } = {}): PoolAlignment {
  const same = { xml, renamed: [] };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || local(root) !== 'definitions' || doc.getElementsByTagName('parsererror').length) return same;

  const all = descendants(root);
  const ids = new Set(all.map(e => e.getAttribute('id')).filter((x): x is string => !!x));
  const map = new Map<string, string>();
  const names = new Map<Element, string>();

  for (const proc of all.filter(e => local(e) === 'process')) {
    const procId = proc.getAttribute('id') ?? '';
    const part = all.find(e => local(e) === 'participant' && e.getAttribute('processRef') === procId) ?? null;
    // the name of the pool — without a pool (or with a business title on it) that of the process
    const name = [part?.getAttribute('name'), proc.getAttribute('name')]
      .map(n => (n ?? '').trim()).find(n => n && isIdLike(n));
    if (!procId || !name) continue;
    const want: Array<[string, string]> = opts.renameProcess || GENERATED.test(procId) ? [[procId, name]] : [];
    if (part) want.push([part.getAttribute('id') ?? '', participantIdOf(name)]);
    for (const [alt, neu] of want) {
      // the new ID already belongs to another element — then better not
      if (!alt || alt === neu || (ids.has(neu) && !want.some(([a]) => a === neu))) continue;
      map.set(alt, neu);
    }
    if ((proc.getAttribute('name') ?? '') !== name) names.set(proc, name);
    if (part && !(part.getAttribute('name') ?? '').trim()) names.set(part, name);
  }
  if (!map.size && !names.size) return same;

  for (const el of all) {
    for (const a of Array.from(el.attributes)) {
      if (a.localName === 'name') continue;
      const neu = map.get(a.value);
      if (neu !== undefined) { el.setAttribute(a.name, neu); continue; }
      const feel = /^=\s*"([^"]*)"\s*$/.exec(a.value);
      const neuFeel = feel ? map.get(feel[1]) : undefined;
      if (neuFeel !== undefined) el.setAttribute(a.name, `="${neuFeel}"`);
    }
  }
  for (const [el, name] of names) el.setAttribute('name', name);

  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  return { xml: out, renamed: [...map.entries()] };
}

/**
 * Rename the process (from the title): the pool or the process gets
 * the new name, ID and pool ID follow. If the name does not work as an ID, the
 * XML comes back unchanged.
 */
export function renameProcess(xml: string, processId: string, name: string): string {
  if (!isIdLike(name)) return xml;
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length) return xml;
  const all = descendants(root);
  const proc = all.find(e => local(e) === 'process' && e.getAttribute('id') === processId);
  if (!proc) return xml;
  proc.setAttribute('name', name);
  const part = all.find(e => local(e) === 'participant' && e.getAttribute('processRef') === processId);
  if (part) part.setAttribute('name', name);
  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  return alignPoolIds(out, { renameProcess: true }).xml;
}

/**
 * The process ID according to house convention: `company-projekt-prozessVersion` —
 * company and project lowercase, the process in camelCase with the version at the end
 * (`globex-savings-openSavingsV1`). The project may consist of several parts.
 */
export const PROCESS_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+-[a-z][A-Za-z0-9]*V\d+$/;

const EXAMPLE_ID = 'globex-savings-openSavingsV1';

export interface ProcessIdCheck {
  /** error: is not applied · warn: is applied, but check it */
  level: 'error' | 'warn';
  text: string;
}

/**
 * What is wrong with a process ID — null if it fits. `prefixes`
 * are the known `company-projekt` (catalog, other specifications):
 * an unknown company is an error, an unknown project of a
 * known company only a warning — otherwise no new project could be
 * started. Without known prefixes only the pattern counts.
 */
export function checkProcessId(id: string, prefixes: string[] = [], legacy = false): ProcessIdCheck | null {
  const t = id.trim();
  const error = (text: string): ProcessIdCheck => ({ level: 'error', text });
  if (!t) return error('Die Prozess-ID fehlt.');
  const parts = t.split('-');
  if (parts.length < 3) return error(`Drei Teile: company-projekt-prozessVersion, z. B. ${EXAMPLE_ID}.`);
  // an old name stays as it is — no convention, no known prefixes
  if (legacy) return null;
  const proc = parts[parts.length - 1];
  if (!PROCESS_ID_PATTERN.test(t)) {
    // the suggestion right away: starting lowercase, without special characters, with version
    const camel = (proc.charAt(0).toLowerCase() + proc.slice(1)).replace(/[^A-Za-z0-9]/g, '') || 'openSavings';
    if (!/V\d+$/.test(proc)) return error(`Der Prozess endet mit der Version — z. B. ${camel}V1.`);
    if (!/^[a-z][A-Za-z0-9]*$/.test(proc)) return error(`Der Prozess in camelCase, klein beginnend — z. B. ${camel}.`);
    return error(`Firma und Projekt klein, ohne Sonderzeichen — z. B. ${EXAMPLE_ID}.`);
  }
  if (!prefixes.length) return null;
  const company = parts[0], prefix = parts.slice(0, -1).join('-');
  if (prefixes.includes(prefix)) return null;
  const companies = [...new Set(prefixes.map(p => p.split('-')[0]))];
  if (!companies.includes(company)) {
    const h = closest(company, companies);
    return error(`Firma «${company}» ist nicht bekannt${h ? ` — meinten Sie «${h}»?` : '.'}`);
  }
  const projects = prefixes.filter(p => p.startsWith(`${company}-`)).map(p => p.slice(company.length + 1));
  const project = parts.slice(1, -1).join('-');
  const h = closest(project, projects);
  return { level: 'warn', text: `Projekt «${project}» gibt es bei ${company} noch nicht — ${h ? `neu, oder meinten Sie «${h}»?` : 'ein neues Projekt?'}` };
}

/** the most similar known value — if one is close enough to be a typo */
function closest(value: string, known: string[]): string | null {
  const best = known.map(k => ({ k, d: distance(value, k) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d <= Math.max(2, Math.floor(value.length / 3)) ? best.k : null;
}

/** Edit distance (Levenshtein) */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
