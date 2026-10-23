// The designer of the pages (E15) - what a page can call, example data for the preview, the
// tree of the building blocks and the findings. Without React, tested like the rest (tests/pagesDesigner.test.ts).
import type { DomainField, DomainType, Field, Model, ProcessSpec, TypeDef } from '../../types';
import { conditionProblem } from '../runtime/expr';
import type { Action, Component, Page } from '../runtime/spec';

// ---------------------------------------------------------------- Fields

/** A field as the designer shows it - from the domain (Scala) or from a process spec. */
export type PField = {
  name: string;
  /** the base type: a scalar (`String`, `LocalDateTime`), an enum or a case class */
  type: string;
  optional: boolean;
  collection: boolean;
  /** the fields of a case class */
  fields?: PField[];
  /** the values of an enum */
  values?: string[];
};

const SCALARS = new Set([
  'String', 'Int', 'Long', 'Double', 'Float', 'BigDecimal', 'Boolean', 'LocalDate', 'LocalDateTime',
  'ZonedDateTime', 'Instant', 'UUID', 'Iso8601Duration', 'Json', 'JsonObject',
]);

/** `Option[Seq[Appointment]]` → base type `Appointment`, optional, a list. */
export function parseScalaType(type: string): { base: string; qualified: string; optional: boolean; collection: boolean } {
  let t = type.trim();
  let optional = false;
  let collection = false;
  for (;;) {
    const m = t.match(/^(Option|Seq|List|Set|Vector)\[(.*)\]$/);
    if (!m) break;
    if (m[1] === 'Option') optional = true;
    else collection = true;
    t = m[2].trim();
  }
  // Iron only now - in `Option[Seq[String :| ValidEmail]]` it is inside
  const qualified = t.replace(/\s*:\|.*$/, '').trim();
  return { base: qualified.split('.').pop() ?? qualified, qualified, optional, collection };
}

/** The domain type of a name - a qualified name (`other.pkg.Customer`) exactly, otherwise first
  * the one from the same package. */
function domainTypeNamed(model: Model, name: string, pkg?: string): DomainType | undefined {
  // also In/Out of a worker (member) - an alias often points there (`type Out = Other.Out`)
  const all = (model.domainTypes ?? []).filter((t) => t.kind === 'case' || t.kind === 'enum' || t.kind === 'alias' || t.kind === 'member');
  const exact = all.find((t) => t.id === name || `${t.pkg}.${t.name}` === name);
  if (exact) return exact;
  // the whole name (`Other.Out`) before the last part (`Out` - that would be every Out)
  const named = all.filter((t) => t.name === name);
  if (named.length) return named.find((t) => t.pkg === pkg) ?? named[0];
  const base = name.split('.').pop() ?? name;
  const matches = all.filter((t) => t.name === name || t.name === base || t.name.endsWith(`.${name}`) || t.name.endsWith(`.${base}`));
  return matches.find((t) => t.pkg === pkg) ?? matches[0];
}

/** The fields of a type as PFields - an alias (`type Out = Other.Out`) via its target; the
  * types of the fields in the package of the type that declares them. */
function fieldsOf(model: Model, t: DomainType | undefined, depth: number, hops = 0): PField[] {
  if (!t) return [];
  if (!t.fields?.length && t.target && hops < 4) {
    const target = domainTypeNamed(model, parseScalaType(t.target).qualified, t.pkg);
    return target && target !== t ? fieldsOf(model, target, depth, hops + 1) : [];
  }
  return (t.fields ?? []).map((f) => fromDomainField(f, model, t.pkg, depth));
}

function fromDomainField(f: DomainField, model: Model, pkg: string | undefined, depth: number): PField {
  const { base, qualified, optional, collection } = parseScalaType(f.type);
  const field: PField = { name: f.name, type: base, optional, collection };
  if (SCALARS.has(base) || depth > 3) return field;
  const dt = domainTypeNamed(model, qualified, pkg);
  if (dt?.kind === 'enum') field.values = dt.values ?? dt.cases?.map((c) => c.name);
  else if (dt) field.fields = fieldsOf(model, dt, depth + 1);
  return field;
}

function fromSpecField(f: Field, spec: ProcessSpec, model: Model, depth: number): PField {
  const local = spec.types?.find((t) => t.id === f.type);
  const field: PField = { name: f.name, type: local?.name ?? f.type.replace(/^dom:/, '').split('.').pop()!, optional: !!f.optional, collection: !!f.collection };
  if (depth > 3) return field;
  if (local?.kind === 'enum') field.values = (local.values ?? []).map((v) => v.name);
  else if (local) field.fields = (local.fields ?? []).map((sub) => fromSpecField(sub, spec, model, depth + 1));
  else if (f.type.startsWith('dom:')) {
    const dt = (model.domainTypes ?? []).find((t) => t.id === f.type.slice(4));
    if (dt?.kind === 'enum') field.values = dt.values;
    else if (dt) field.fields = (dt.fields ?? []).map((sub) => fromDomainField(sub, model, dt.pkg, depth + 1));
  }
  return field;
}

const specFields = (t: TypeDef | undefined, spec: ProcessSpec, model: Model): PField[] =>
  (t?.fields ?? []).map((f) => fromSpecField(f, spec, model, 0));

// ---------------------------------------------------------------- Targets

/** What a page can call - services (workers), processes, messages and user tasks. */
export type Targets = {
  services: { topic: string; name: string; descr?: string; in: PField[]; out: PField[] }[];
  processes: { key: string; title: string; in: PField[] }[];
  messages: { name: string; process: string; in: PField[] }[];
  userTasks: { key: string; name: string; process: string; in: PField[]; out: PField[] }[];
};

/** The worker objects of the domain (`val topicName`) with their In/Out - and the processes of the specs. */
export function targetsOf(model: Model, specs: ProcessSpec[]): Targets {
  const domain = model.domainTypes ?? [];
  const member = (topic: string, which: 'In' | 'Out') => domain.find((t) => t.topicName === topic && t.name.endsWith(`.${which}`));
  const topics = [...new Set(domain.filter((t) => t.topicName && (t.dsl ?? '').match(/Task|Worker/)).map((t) => t.topicName!))];
  const processKeys = new Set(specs.map((s) => s.processId));
  // the workers of a process (`<processKey>-<Step>`) run in it - a page calls the others
  const ofProcess = (topic: string) => [...processKeys].some((k) => k && topic.startsWith(`${k}-`));
  const services = topics
    .filter((topic) => !processKeys.has(topic) && !ofProcess(topic))
    .map((topic) => {
      const inT = member(topic, 'In');
      const outT = member(topic, 'Out');
      const owner = domain.find((t) => t.topicName === topic);
      return {
        topic,
        name: owner?.owner ?? owner?.name.split('.')[0] ?? topic,
        descr: owner?.ownerDescr,
        in: fieldsOf(model, inT, 0),
        out: fieldsOf(model, outT, 0),
      };
    })
    .sort((a, b) => a.topic.localeCompare(b.topic));
  const processes = specs
    .filter((s) => s.processId)
    .map((s) => ({ key: s.processId!, title: s.title, in: specFields(s.types?.find((t) => t.root), s, model) }));
  const messages = specs.flatMap((s) =>
    (s.interactions ?? [])
      .filter((i) => i.kind === 'message')
      .map((i) => ({ name: i.key, process: s.processId ?? s.slug, in: specFields(s.types?.find((t) => t.id === i.inTypeId), s, model) })),
  );
  const userTasks = specs.flatMap((s) =>
    (s.interactions ?? [])
      .filter((i) => i.kind === 'userTask')
      .map((i) => ({
        key: i.key,
        name: i.name,
        process: s.processId ?? s.slug,
        in: specFields(s.types?.find((t) => t.id === i.inTypeId), s, model),
        out: specFields(s.types?.find((t) => t.id === i.outTypeId), s, model),
      })),
  );
  return { services, processes, messages, userTasks };
}

/** An input for an action with every field of the In type: `{"topic": "{{topic}}", …}`. */
export function inputSkeleton(fields: PField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, `{{${f.name}}}`]));
}

// ---------------------------------------------------------------- Example data

/** Example data of a type - for the preview: three entries per list, dates on the next days. */
export function sampleOf(fields: PField[], index = 0): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.name, sampleField(f, index)]));
}

function sampleField(f: PField, index: number): unknown {
  if (f.collection) return [0, 1, 2].map((i) => sampleValue(f, index * 3 + i));
  return sampleValue(f, index);
}

function sampleValue(f: PField, i: number): unknown {
  if (f.values?.length) return f.values[i % f.values.length];
  if (f.fields) return sampleOf(f.fields, i);
  const day = new Date();
  day.setDate(day.getDate() + 1 + Math.floor(i / 2));
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  // a start and an end of the same slot get adjacent times
  const hour = 9 + (i % 2) * 2 + (/end|bis|until/i.test(f.name) ? 1 : 0);
  switch (f.type) {
    case 'Int':
    case 'Long':
    case 'Double':
    case 'Float':
    case 'BigDecimal':
      return i + 1;
    case 'Boolean':
      return true;
    case 'LocalDate':
      return date;
    case 'LocalDateTime':
    case 'ZonedDateTime':
    case 'Instant':
      return `${date}T${String(hour).padStart(2, '0')}:00`;
    case 'UUID':
      return `00000000-0000-0000-0000-00000000000${i}`;
    default:
      if (/mail/i.test(f.name)) return `beispiel${i || ''}@example.ch`;
      if (/name/i.test(f.name)) return ['Anna Berater', 'Marco Berater', 'Eva Muster'][i % 3];
      if (/id$|token/i.test(f.name)) return `${f.name}-${i + 1}`;
      return `Beispiel ${f.name}`;
  }
}

// ---------------------------------------------------------------- the tree of building blocks

/** The key of a building block: its index path in `body` - `"2"`, `"2.1"` (in a section). */
export type BlockKey = string;

export function blockAt(body: Component[], key: BlockKey): Component | undefined {
  if (!/^\d+(\.\d+)*$/.test(key)) return undefined; // '' (the page) is not a building block - Number('') would be 0
  const [head, ...rest] = key.split('.').map(Number);
  const block = body[head];
  if (!block || rest.length === 0) return block;
  return block.type === 'section' ? blockAt(block.body, rest.join('.')) : undefined;
}

/** A new body in which the building block at `key` is replaced (`fn` gets the old one). */
export function updateBlock(body: Component[], key: BlockKey, fn: (b: Component) => Component): Component[] {
  const [head, ...rest] = key.split('.').map(Number);
  return body.map((b, i) => {
    if (i !== head) return b;
    if (rest.length === 0) return fn(b);
    return b.type === 'section' ? { ...b, body: updateBlock(b.body, rest.join('.'), fn) } : b;
  });
}

/** The list a key is in, and its index in it - as a function on that list. */
function inParent(body: Component[], key: BlockKey, fn: (list: Component[], index: number) => Component[]): Component[] {
  const parts = key.split('.').map(Number);
  const index = parts.pop()!;
  if (parts.length === 0) return fn(body, index);
  return updateBlock(body, parts.join('.'), (b) => (b.type === 'section' ? { ...b, body: fn(b.body, index) } : b));
}

export function removeBlock(body: Component[], key: BlockKey): Component[] {
  return inParent(body, key, (list, i) => list.filter((_, j) => j !== i));
}

/** Moves a building block one up (-1) or down (+1) in its list - the new key. */
export function moveBlock(body: Component[], key: BlockKey, by: -1 | 1): { body: Component[]; key: BlockKey } {
  const parts = key.split('.').map(Number);
  const index = parts[parts.length - 1];
  let target = index;
  const next = inParent(body, key, (list, i) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    target = j;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  return { body: next, key: [...parts.slice(0, -1), target].join('.') };
}

/** Inserts after `key` - or into a section (as the last one), or without key at the end. The new key. */
export function insertBlock(body: Component[], block: Component, key?: BlockKey, into = false): { body: Component[]; key: BlockKey } {
  if (key === undefined) return { body: [...body, block], key: String(body.length) };
  const at = blockAt(body, key);
  if (into && at?.type === 'section') {
    return { body: updateBlock(body, key, (b) => (b.type === 'section' ? { ...b, body: [...b.body, block] } : b)), key: `${key}.${at.body.length}` };
  }
  const parts = key.split('.').map(Number);
  const index = parts[parts.length - 1];
  return {
    body: inParent(body, key, (list, i) => [...list.slice(0, i + 1), block, ...list.slice(i + 1)]),
    key: [...parts.slice(0, -1), index + 1].join('.'),
  };
}

/** Where a building block goes, relative to another one - before, after or (into a section) inside. */
export type Place = 'before' | 'after' | 'inside';

/** Inserts `block` into the list `parent` (key of a section, '' for the page) at `index`. */
function insertAt(body: Component[], parent: BlockKey, index: number, block: Component): Component[] {
  const put = (list: Component[]) => [...list.slice(0, index), block, ...list.slice(index)];
  return parent === '' ? put(body) : updateBlock(body, parent, (b) => (b.type === 'section' ? { ...b, body: put(b.body) } : b));
}

const parentOf = (key: BlockKey) => key.split('.').slice(0, -1).join('.');
const indexOf = (key: BlockKey) => Number(key.split('.').pop());
const keyIn = (parent: BlockKey, index: number) => (parent === '' ? String(index) : `${parent}.${index}`);

/** Inserts before or after `key` - or into the section `key` (as the last one). The new key. */
export function placeBlock(body: Component[], block: Component, key: BlockKey, place: Place): { body: Component[]; key: BlockKey } {
  const at = blockAt(body, key);
  // not a building block (the page itself, '') - at the end of the page, not silently at the start
  if (!at) return { body: [...body, block], key: String(body.length) };
  if (place === 'inside' && at.type === 'section') return { body: insertAt(body, key, at.body.length, block), key: `${key}.${at.body.length}` };
  // «inside» something that is not a section: after it
  const index = indexOf(key) + (place === 'before' ? 0 : 1);
  return { body: insertAt(body, parentOf(key), index, block), key: keyIn(parentOf(key), index) };
}

/** Moves a building block to another place (drag & drop) - the new key. Into itself
  * or its children does not work: then everything stays as it is. */
export function relocateBlock(body: Component[], from: BlockKey, to: BlockKey, place: Place): { body: Component[]; key: BlockKey } {
  const block = blockAt(body, from);
  if (!block || from === to || to.startsWith(`${from}.`)) return { body, key: from };
  // onto the page itself (''): at the end - ''.split('.') would otherwise be building block 0. Another key
  // without a building block (e.g. an old drop target after ⌘Z in the middle of dragging): move nothing
  if (to === '') return placeBlock(removeBlock(body, from), block, '', place);
  if (!blockAt(body, to)) return { body, key: from };
  // after removing, a later sibling path (or one inside it) moves up by one
  const fromParts = from.split('.').map(Number);
  const toParts = to.split('.').map(Number);
  const depth = fromParts.length - 1;
  const sameParent = toParts.length > depth && fromParts.slice(0, depth).every((p, i) => p === toParts[i]);
  if (sameParent && toParts[depth] > fromParts[depth]) toParts[depth] -= 1;
  return placeBlock(removeBlock(body, from), block, toParts.join('.'), place);
}

/** Wraps a building block in a new section (in its place). */
export function wrapInSection(body: Component[], key: BlockKey): { body: Component[]; key: BlockKey } {
  const block = blockAt(body, key);
  if (!block) return { body, key };
  return { body: updateBlock(body, key, (b) => ({ type: 'section', label: 'Abschnitt', body: [b] })), key };
}

/** Dissolves a section: its building blocks then stand in its place. */
export function unwrapSection(body: Component[], key: BlockKey): { body: Component[]; key: BlockKey } {
  const section = blockAt(body, key);
  if (section?.type !== 'section') return { body, key };
  const parent = parentOf(key);
  const index = indexOf(key);
  let next = removeBlock(body, key);
  section.body.forEach((b, i) => { next = insertAt(next, parent, index + i, b); });
  // an empty section: afterwards its parent is selected (the page: '')
  return { body: next, key: section.body.length ? keyIn(parent, index) : parent };
}

/** The text that names a building block - heading, text, label or caption. */
function titleOf(b: Component): string | undefined {
  switch (b.type) {
    case 'heading':
    case 'text':
    case 'loading':
      return b.text;
    default:
      return b.label;
  }
}

/** What a change of type of the building block loses - for the warning in the menu; null if there is nothing of its own.
  * (A section with building blocks does not change its type at all - dissolve it first.) */
export function lostOnConvert(b: Component): string | null {
  const n = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);
  switch (b.type) {
    case 'section': return b.body.length ? n(b.body.length, 'Baustein', 'Bausteine') : null;
    case 'fields': return b.fields.length ? n(b.fields.length, 'Eingabefeld', 'Eingabefelder') : null;
    case 'summary': return b.items.length ? n(b.items.length, 'Zeile', 'Zeilen') : null;
    case 'button': return b.actions.length ? n(b.actions.length, 'Aktion', 'Aktionen') : null;
    case 'choice': return b.options.length ? n(b.options.length, 'Option', 'Optionen') : null;
    default: return null;
  }
}

/** A building block in another type: what fits stays - the text (as heading, text, label),
  * the binding of a selection, the condition; the rest comes from the new type. */
export function convertBlock(b: Component, type: Component['type']): Component {
  if (b.type === type) return b;
  const fresh = newBlock(type) as Component & Record<string, unknown>;
  const title = titleOf(b);
  const next: Record<string, unknown> = { ...fresh };
  if (title !== undefined && title !== '') {
    if (type === 'heading' || type === 'text' || type === 'loading') next.text = title;
    else next.label = title;
  }
  if ((b.type === 'choice' || b.type === 'pick') && (type === 'choice' || type === 'pick')) {
    next.bind = b.bind;
    if (b.required !== undefined) next.required = b.required;
  }
  if (b.visible) next.visible = b.visible;
  return next as Component;
}

/** Every building block with its key - depth first, as the outline shows them. */
export function flatten(body: Component[], prefix = ''): { key: BlockKey; block: Component; depth: number }[] {
  return body.flatMap((block, i) => {
    const key = prefix ? `${prefix}.${i}` : String(i);
    const self = { key, block, depth: prefix ? prefix.split('.').length : 0 };
    return block.type === 'section' ? [self, ...flatten(block.body, key)] : [self];
  });
}

/** A new building block of a type - with what it needs to show something. */
export function newBlock(type: Component['type']): Component {
  switch (type) {
    case 'heading':
      return { type, text: 'Überschrift' };
    case 'text':
      return { type, text: 'Text' };
    case 'choice':
      return { type, bind: 'choice', label: 'Auswahl', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };
    case 'pick':
      return { type, bind: 'selected', label: 'Auswahl', items: 'items', itemLabel: '{{name}}' };
    case 'fields':
      return { type, fields: [{ bind: 'name', label: 'Name', required: true }] };
    case 'summary':
      return { type, items: [{ label: 'Bezeichnung', value: '{{name}}' }] };
    case 'button':
      return { type, label: 'Senden', validate: true, actions: [] };
    case 'section':
      return { type, label: 'Abschnitt', body: [] };
    case 'loading':
      return { type, text: 'Einen Moment …' };
  }
}

// ---------------------------------------------------------------- the actions of a page


/** Every action of a page with its location - load, a button, onChange, onError. */
export function actionsOf(page: Page): { where: string; key?: BlockKey; action: Action }[] {
  const nested = (where: string, actions: Action[] | undefined, key?: BlockKey): { where: string; key?: BlockKey; action: Action }[] =>
    (actions ?? []).flatMap((action) => [
      { where, key, action },
      ...('onError' in action ? nested(`${where} (onError)`, action.onError, key) : []),
    ]);
  return [
    ...nested('Laden', page.load),
    ...flatten(page.body).flatMap(({ key, block }) =>
      block.type === 'button'
        ? nested(`Button «${block.label}»`, block.actions, key)
        : block.type === 'choice'
          ? nested(`Auswahl «${block.label ?? block.bind}»`, block.onChange, key)
          : [],
    ),
  ];
}

/** The paths of the state a page knows: its state, the results of its actions (with fields), query, user. */
export function statePaths(page: Page, targets: Targets): string[] {
  const paths = new Set<string>();
  const add = (prefix: string, fields: PField[], depth = 0) => {
    for (const f of fields) {
      const path = `${prefix}.${f.name}`;
      paths.add(path);
      if (f.fields && depth < 2) add(f.collection ? `${path}.0` : path, f.fields, depth + 1);
    }
  };
  const walk = (prefix: string, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${k}` : k;
        paths.add(path);
        walk(path, v);
      }
    }
  };
  walk('', page.state ?? {});
  for (const { action } of actionsOf(page)) {
    if (action.do === 'call' && action.result) {
      paths.add(action.result);
      const svc = targets.services.find((s) => s.topic === action.service);
      if (svc) add(action.result, svc.out);
    } else if ((action.do === 'start' || action.do === 'message') && action.result) paths.add(action.result);
  }
  for (const { block } of flatten(page.body)) {
    if (block.type === 'choice' || block.type === 'pick') paths.add(block.bind);
    if (block.type === 'fields') block.fields.forEach((f) => paths.add(f.bind));
  }
  ['query', 'user.name', 'user.email', 'user.roles'].forEach((p) => paths.add(p));
  return [...paths].sort();
}

/** An entry in the state of a page - where it comes from and what is in it (for «Daten» in the designer). */
export type DataNode = {
  path: string;
  /** where from: initial state, an action (with service), an input, the URL, the user */
  sources: string[];
  /** the type - from the domain (e.g. `Slot`, `LocalDateTime`) or a simple one (text, number, list) */
  type?: string;
  collection?: boolean;
  /** the fields - the Out of a service or the fields of a case class */
  fields?: PField[];
  /** fixed values (of a selection) or those of an enum */
  values?: string[];
  /** the building block that sets it - for a click to go there */
  key?: BlockKey;
};

const jsType = (v: unknown): string =>
  v === null ? 'leer' : Array.isArray(v) ? 'Liste' : typeof v === 'object' ? 'Objekt' : typeof v === 'number' ? 'Zahl'
    : typeof v === 'boolean' ? 'Ja/Nein' : 'Text';

/** The fields of a value of the initial state (an object, a list of objects) - for the paths inside it. */
function fieldsOfValue(v: unknown, depth = 0): PField[] | undefined {
  const item = Array.isArray(v) ? v[0] : v;
  if (typeof item !== 'object' || item === null || Array.isArray(item) || depth > 3) return undefined;
  return Object.entries(item).map(([name, x]) => ({
    name, type: jsType(Array.isArray(x) ? x[0] : x), optional: false, collection: Array.isArray(x), fields: fieldsOfValue(x, depth + 1),
  }));
}

/** A path below a node (`contact.email` → the field `email` of `contact`) - mixed into the fields. */
function withPath(fields: PField[] | undefined, parts: string[], type: string): PField[] {
  const [name, ...rest] = parts;
  const list = [...(fields ?? [])];
  const i = list.findIndex((f) => f.name === name);
  const old = i >= 0 ? list[i] : { name, type: rest.length ? 'Objekt' : type, optional: false, collection: false };
  const next = rest.length ? { ...old, fields: withPath(old.fields, rest, type) } : old;
  if (i >= 0) list[i] = next;
  else list.push(next);
  return list;
}

/** What is in the state of a page: the initial state, the results of its actions (with the Out of the
  * service), the inputs of its building blocks, the parameters of the URL and the user. A path that several
  * set (initial state and selection) appears once - with all sources. */
export function dataOf(page: Page, targets: Targets): DataNode[] {
  const nodes = new Map<string, DataNode>();
  const put = (path: string, source: string, rest: Omit<DataNode, 'path' | 'sources'> = {}) => {
    const node = nodes.get(path);
    if (node) {
      if (!node.sources.includes(source)) node.sources.push(source);
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && (node as Record<string, unknown>)[k] === undefined) (node as Record<string, unknown>)[k] = v;
    } else nodes.set(path, { path, sources: [source], ...rest });
  };
  // a list: its fields are those of an entry - the path to it has the index ({{items.0.id}})
  for (const [k, v] of Object.entries(page.state ?? {}))
    put(k, 'Anfangszustand', { type: jsType(v), fields: fieldsOfValue(v), collection: Array.isArray(v) || undefined });
  for (const { where, key, action } of actionsOf(page)) {
    if (action.do === 'call' && action.result) {
      const svc = targets.services.find((s) => s.topic === action.service);
      put(action.result, `${where}: ${action.service}`, { type: svc ? `${svc.name}.Out` : 'unbekannter Service', fields: svc?.out, key });
    } else if (action.do === 'start' && action.result) put(action.result, `${where}: Start ${action.process}`, { type: 'Prozess-Start', key });
    else if (action.do === 'message' && action.result) put(action.result, `${where}: Message ${action.name}`, { type: 'Message', key });
    else if (action.do === 'set') put(action.path.split('.')[0], `${where}: Wert setzen`, { key });
  }
  for (const { key, block } of flatten(page.body)) {
    if (block.type === 'choice')
      put(block.bind, `Auswahl «${block.label ?? block.bind}»`, { type: 'ein Wert der Auswahl', values: block.options.map((o) => String(o.value)), key });
    if (block.type === 'pick') put(block.bind, `Auswahl aus Liste «${block.label ?? block.bind}»`, { type: `ein Eintrag aus ${block.items}`, key });
    if (block.type === 'fields')
      for (const f of block.fields) {
        const [head, ...rest] = f.bind.split('.');
        put(head, `Eingabefeld «${f.label}»`, { type: rest.length ? 'Objekt' : 'Text', key });
        // a field below it (`contact.email`): as a field of the object - so {{contact.email}} can be copied
        const node = nodes.get(head)!;
        if (rest.length) node.fields = withPath(node.fields, rest, 'Text');
      }
  }
  // the parameters of the URL the page reads
  for (const m of JSON.stringify(page).matchAll(/\{\{\s*query\.([\w$]+)/g)) put(`query.${m[1]}`, 'URL-Parameter', { type: 'Text' });
  put('user', 'Benutzer (mit Login)', { type: 'name, email, roles' });
  return [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------- the findings

export type PageFinding = { level: 'error' | 'warning' | 'info'; message: string; key?: BlockKey };

/** What does not fit - the services, processes, messages and tasks a page calls, and its paths. */
export function pageFindings(page: Page, targets: Targets, others: Page[] = []): PageFinding[] {
  const findings: PageFinding[] = [];
  if (!page.title?.trim()) findings.push({ level: 'error', message: 'Die Seite hat keinen Titel.' });
  if (!page.path?.trim()) findings.push({ level: 'error', message: 'Die Seite hat keinen Pfad.' });
  else if (others.some((o) => o !== page && o.path === page.path))
    findings.push({ level: 'error', message: `Den Pfad «${page.path}» hat noch eine andere Seite.` });
  if (page.access !== 'public' && !page.access?.roles?.length)
    findings.push({ level: 'warning', message: 'Die Seite verlangt einen Login, aber keine Rolle.' });

  // the hint for the gateway once per name - not for every action that calls it
  const hinted = new Set<string>();
  const gatewayHint = (name: string, list: string, key?: BlockKey) => {
    if (hinted.has(name)) return;
    hinted.add(name);
    // the field of orchescala.gateway.PublicAccess - how a company fills it (e.g. from the environment) is its own business
    findings.push({ level: 'info', key, message: `«${name}» muss der Gateway öffentlich freigeben (${list}).` });
  };
  for (const { where, key, action } of actionsOf(page)) {
    // on a public page nobody has a token - without `public` the call would come back with 401
    if (page.access === 'public' && (action.do === 'call' || action.do === 'start' || action.do === 'message') && !action.public)
      findings.push({ level: 'error', key, message: `${where}: auf einer öffentlichen Seite braucht der Aufruf «ohne Login» – sonst 401.` });
    switch (action.do) {
      case 'call': {
        const svc = targets.services.find((s) => s.topic === action.service);
        if (!svc) findings.push({ level: 'warning', key, message: `${where}: den Service «${action.service}» kennt der Katalog nicht.` });
        else for (const f of svc.in.filter((f) => !f.optional && !(action.input && typeof action.input === 'object' && f.name in (action.input as object))))
          findings.push({ level: 'info', key, message: `${where}: «${action.service}» – das Feld «${f.name}» fehlt in der Eingabe (sein Vorgabewert gilt).` });
        if (action.public && page.access !== 'public')
          findings.push({ level: 'info', key, message: `${where}: «${action.service}» ohne Login auf einer Seite mit Login.` });
        if (action.public) gatewayHint(action.service, 'PublicAccess.workers', key);
        break;
      }
      case 'start':
        if (!targets.processes.some((p) => p.key === action.process))
          findings.push({ level: 'warning', key, message: `${where}: den Prozess «${action.process}» gibt es in den Spezifikationen nicht.` });
        if (action.public) gatewayHint(action.process, 'PublicAccess.processStarts', key);
        break;
      case 'message':
        if (!targets.messages.some((m) => m.name === action.name))
          findings.push({ level: 'warning', key, message: `${where}: die Message «${action.name}» gibt es in den Spezifikationen nicht.` });
        // without a business key the message does not find its instance (at runtime the action fails)
        if (!action.businessKey?.trim())
          findings.push({ level: 'error', key, message: `${where}: die Message «${action.name}» braucht einen Business Key.` });
        if (action.public) gatewayHint(action.name, 'PublicAccess.messages', key);
        break;
      case 'completeTask':
        if (!targets.userTasks.some((t) => t.key === action.taskKey))
          findings.push({ level: 'warning', key, message: `${where}: den Benutzer-Task «${action.taskKey}» gibt es in den Spezifikationen nicht.` });
        if (page.access === 'public')
          findings.push({ level: 'error', key, message: `${where}: einen Task abschliessen geht nur mit Login.` });
        break;
      case 'set':
        break;
    }
  }

  // the paths of the building blocks - in the state the page knows
  const known = statePaths(page, targets);
  const isKnown = (path: string) =>
    known.some((k) => k === path || path.startsWith(`${k}.`) || k.startsWith(`${path}.`)) || path.startsWith('query.');
  for (const { key, block } of flatten(page.body)) {
    // the conditions - one that does not fit would otherwise silently hide
    const conditions = [
      block.visible,
      ...(block.type === 'fields' ? block.fields.map((f) => f.visible) : []),
      ...(block.type === 'summary' ? block.items.map((i) => i.visible) : []),
    ];
    for (const cond of conditions) {
      const problem = conditionProblem(cond);
      if (problem) findings.push({ level: 'warning', key, message: `Sichtbar, wenn «${cond}»: ${problem}.` });
    }
    if (block.type === 'pick' && !isKnown(block.items))
      findings.push({ level: 'warning', key, message: `Die Liste «${block.items}» kommt von keiner Aktion der Seite.` });
    for (const path of templatePaths(block)) {
      if (!isKnown(path)) findings.push({ level: 'warning', key, message: `«{{${path}}}» kommt im Zustand der Seite nicht vor.` });
    }
  }
  return findings;
}

/** The paths of the state in the texts of a building block - not those of a list entry (pick). */
function templatePaths(block: Component): string[] {
  const texts: string[] = [];
  switch (block.type) {
    case 'heading':
    case 'text':
      texts.push(block.text);
      break;
    case 'summary':
      block.items.forEach((i) => texts.push(i.value));
      break;
    case 'button':
      texts.push(block.label);
      break;
  }
  return texts.flatMap((t) => [...t.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)].map((m) => m[1]));
}

/** The slug of a page file from its path: `appointments/book` → `book`. */
export function slugOf(path: string): string {
  return (path.split('/').filter(Boolean).pop() ?? 'page').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}
