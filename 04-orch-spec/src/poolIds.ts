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
// Topic die Prozess-ID ist) — Namen ausgenommen.

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
      if (neu !== undefined) el.setAttribute(a.name, neu);
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
