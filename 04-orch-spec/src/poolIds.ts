// Pool und Prozess heissen gleich.
//
// Im Diagramm benennt man den Pool — der Prozess dahinter behält die ID, die
// der Modeler ihm gegeben hat (`Process_0jx2w61`). Daran hängt aber alles:
// Topics, die Zuordnung zur Domain, Projekt und Dateiname. Darum gilt die
// Konvention der Vorlagen:
//
//   Pool      name = <Name>          id = <Name>-participant
//   Prozess   name = <Name>          id = <Name>
//
// Massgeblich ist der Name des Pools — aber nur, wenn er als ID taugt
// (`globex-savings-openSavingsV1`). Hat das Diagramm keinen Pool (so legt
// der Camunda Modeler einen C8-Prozess an) oder trägt der Pool einen
// fachlichen Titel mit Leerzeichen, gilt der Name des Prozesses; taugt auch
// der nicht, wird nichts angeglichen.
//
// Die **Prozess-ID** ist ein Vertrag (Deployment, Topics, Aufrufer) — sie
// folgt dem Namen nur, wenn sie noch die des Modelers ist (`Process_…`) oder
// jemand den Namen gerade geändert hat (`renameProcess`). Sonst würde das
// blosse Öffnen einen Prozess umbenennen, dessen Pool etwas anders heisst.
//
// Umbenannt wird überall, wo die alte ID **als ganzer Wert** steht
// (`processRef`, `bpmnElement`, Nachrichtenflüsse, der Init-Worker, dessen
// Topic die Prozess-ID ist) oder als FEEL-Text `="<ID>"` (Camunda 8, z. B.
// `processDefinitionKey` beim Prozess-Event) — Namen ausgenommen.

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

/** taugt als BPMN-ID (NCName ohne Doppelpunkt) */
export const isIdLike = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s);

export const participantIdOf = (name: string): string => `${name}-participant`;

/** vom Modeler vergebene ID (`Process_0jx2w61`) — noch von niemandem gewählt */
const GENERATED = /^Process_[A-Za-z0-9]+$/;

/** Die Namen, nach denen sich die Prozesse richten — ändern sie sich, wird umbenannt */
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
  /** was umbenannt wurde: alt → neu */
  renamed: Array<[string, string]>;
}

/**
 * Prozess-ID und -Name nach dem Namen des Pools, die Pool-ID mit
 * `-participant` dahinter. Ändert sich nichts, kommt das XML unverändert
 * zurück (derselbe String).
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
    // der Name des Pools — ohne Pool (oder mit fachlichem Titel darauf) der des Prozesses
    const name = [part?.getAttribute('name'), proc.getAttribute('name')]
      .map(n => (n ?? '').trim()).find(n => n && isIdLike(n));
    if (!procId || !name) continue;
    const want: Array<[string, string]> = opts.renameProcess || GENERATED.test(procId) ? [[procId, name]] : [];
    if (part) want.push([part.getAttribute('id') ?? '', participantIdOf(name)]);
    for (const [alt, neu] of want) {
      // die neue ID gehört schon einem anderen Element — dann lieber nicht
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
 * Den Prozess umbenennen (aus dem Titel heraus): Pool bzw. Prozess bekommt
 * den neuen Namen, ID und Pool-ID folgen. Taugt der Name nicht als ID, kommt
 * das XML unverändert zurück.
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
 * Die Prozess-ID nach Hauskonvention: `company-projekt-prozessVersion` —
 * Firma und Projekt klein, der Prozess in camelCase mit Version am Ende
 * (`globex-savings-openSavingsV1`). Das Projekt darf mehrteilig sein.
 */
export const PROCESS_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+-[a-z][A-Za-z0-9]*V\d+$/;

const EXAMPLE_ID = 'globex-savings-openSavingsV1';

export interface ProcessIdCheck {
  /** error: wird nicht übernommen · warn: wird übernommen, aber prüfen */
  level: 'error' | 'warn';
  text: string;
}

/**
 * Was an einer Prozess-ID nicht stimmt — null, wenn sie passt. `prefixes`
 * sind die bekannten `company-projekt` (Katalog, andere Spezifikationen):
 * eine unbekannte Firma ist ein Fehler, ein unbekanntes Projekt einer
 * bekannten Firma nur eine Warnung — sonst liesse sich kein neues Projekt
 * anfangen. Ohne bekannte Prefixe zählt nur das Muster.
 */
export function checkProcessId(id: string, prefixes: string[] = []): ProcessIdCheck | null {
  const t = id.trim();
  const error = (text: string): ProcessIdCheck => ({ level: 'error', text });
  if (!t) return error('Die Prozess-ID fehlt.');
  const parts = t.split('-');
  if (parts.length < 3) return error(`Drei Teile: company-projekt-prozessVersion, z. B. ${EXAMPLE_ID}.`);
  const proc = parts[parts.length - 1];
  if (!PROCESS_ID_PATTERN.test(t)) {
    // der Vorschlag gleich richtig: klein beginnend, ohne Sonderzeichen, mit Version
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

/** der ähnlichste bekannte Wert — wenn einer nah genug ist, um ein Tippfehler zu sein */
function closest(value: string, known: string[]): string | null {
  const best = known.map(k => ({ k, d: distance(value, k) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d <= Math.max(2, Math.floor(value.length / 3)) ? best.k : null;
}

/** Editierdistanz (Levenshtein) */
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
