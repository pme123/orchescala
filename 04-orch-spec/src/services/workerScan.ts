// A CustomWorker of a service orchestration read back - the way from the code into the spec.
//
// It reads the worker in the form the export writes it (scalaOrchestration.ts):
//
//   override def runWorkZIO(in: In): RunWorkZIOOutput[Out] =
//     for
//       clientKey1 <- ZIO.fromOption(in.client.clientKey).orElseFail(CustomError("…"))
//       getClient <- runGetClient(GetClient.In(clientKey = clientKey1))   → a service call, its inputs
//       client = getClient.client                                          → an output of that call
//       newClient <- mapClient(in.existing, client)                        → a mapping, its method below
//     yield …
//
//   def mapClient(existing: Client, client: Client): IO[CustomError, Client] =
//     for
//       firstName <- ZIO.fromOption(client.name).orElseFail(…)            → a required value
//       built <- mapped("Map Client")(
//         existing.copy(firstName = firstName, country = client.code.map(_.toCountry))
//       )                                                                   → the lines of the mapping
//     yield built
//
// What it does not know (code written by hand) it does not guess: such a place is "not readable".
// The sync compares the code with what the export writes for the spec as it is - only what differs
// goes back into the spec (see syncWorker), so an unchanged worker changes nothing.

/** A member of the worker class: `def name(params): Result =` and its body (unindented). */
export interface ScalaMethod {
  name: string;
  params: { name: string; type: string }[];
  result: string;
  body: string;
}

/** A statement of the `for` of `runWorkZIO`, as the export writes them. */
export type WorkerItem =
  | { kind: 'service'; service: string; target: string; args: Map<string, string> | null; outputs: Map<string, string>; raw: string }
  | { kind: 'mapping'; method: string; names: string[]; args: string[]; outputs: Map<string, string>; raw: string }
  | { kind: 'block'; raw: string };

export interface WorkerCode {
  /** the statements of `runWorkZIO` - null: it has none in the form of the export */
  items: WorkerItem[] | null;
  methods: Map<string, ScalaMethod>;
}

const indentOf = (l: string) => l.length - l.trimStart().length;

/** The index of the bracket that closes the one at `at` - strings and nested brackets skipped; -1 for none. */
export function closing(text: string, at: number): number {
  const open = text[at];
  const close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // a string - `"""` too
      if (text.startsWith('"""', i)) { const e = text.indexOf('"""', i + 3); if (e < 0) return -1; i = e + 2; continue; }
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    // a line comment: to the end of its line - a bracket or quote in it counts for nothing
    if (ch === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** The depth of the brackets a line leaves open - strings and comments skipped. */
function depthOf(line: string): number {
  let d = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { for (i++; i < line.length && line[i] !== '"'; i++) if (line[i] === '\\') i++; continue; }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '/' && line[i + 1] === '*') { const e = line.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) d--;
  }
  return d;
}

/** Split at the top level - not inside brackets or strings. */
export function splitTop(text: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e >= 0) i = e + 1; continue; }
    if (ch === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (depth === 0 && text.startsWith(sep, i)) { out.push(text.slice(start, i)); start = i + sep.length; i += sep.length - 1; }
  }
  out.push(text.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

/** The lines below the first one, unindented by `by`. */
const dedent = (lines: string[], by: number) => lines.map(l => (l.trim() ? l.slice(Math.min(by, indentOf(l))) : '')).join('\n');

/** The statements of a block: a line of its indentation starts one - it goes on while a bracket is open or the next line is deeper. */
export function statements(body: string): string[] {
  const lines = body.split('\n');
  const base = Math.min(...lines.filter(l => l.trim()).map(indentOf));
  const out: string[] = [];
  let cur: string[] = [];
  let depth = 0;
  for (const l of lines) {
    if (!l.trim()) { if (cur.length) cur.push(''); continue; }
    if (cur.length && depth <= 0 && indentOf(l) <= base) { out.push(dedent(cur, base).trim()); cur = []; depth = 0; }
    cur.push(l);
    depth += depthOf(l);
  }
  if (cur.length) out.push(dedent(cur, base).trim());
  return out.filter(s => s && !s.startsWith('//'));
}

const DEF = /^ {2}(?:(?:override|protected|private|final)\s+)*def\s+(\w+)\s*(\(.*)$/;

/** The methods of the worker class. */
export function methodsOf(text: string): Map<string, ScalaMethod> {
  const lines = text.split('\n');
  const out = new Map<string, ScalaMethod>();
  for (let i = 0; i < lines.length; i++) {
    const m = DEF.exec(lines[i]);
    if (!m) continue;
    const head = m[2];
    const close = closing(head, 0);
    if (close < 0) continue;
    const params = splitTop(head.slice(1, close)).map(p => {
      const at = p.indexOf(':');
      return at < 0 ? { name: p.trim(), type: '' } : { name: p.slice(0, at).trim().replace(/^`|`$/g, ''), type: p.slice(at + 1).trim() };
    });
    const result = head.slice(close + 1).replace(/^\s*:\s*/, '').replace(/\s*=\s*$/, '').trim();
    const body: string[] = [];
    let k = i + 1;
    for (; k < lines.length; k++) {
      const l = lines[k];
      if (l.trim() && indentOf(l) <= 2) break;
      body.push(l);
    }
    while (body.length && !body[body.length - 1].trim()) body.pop();
    out.set(m[1], { name: m[1], params, result, body: dedent(body, 4) });
    i = k - 1;
  }
  return out;
}

/** `ZIO.fromOption(E).orElseFail(…)` → E */
function fromOption(io: string): string | null {
  const t = io.trim();
  if (!t.startsWith('ZIO.fromOption(')) return null;
  const at = 'ZIO.fromOption'.length;
  const e = closing(t, at);
  if (e < 0 || !t.slice(e + 1).trim().startsWith('.orElseFail(')) return null;
  return t.slice(at + 1, e).trim();
}

/** `name <- rhs` / `name = rhs` - the name (a pattern) and the right side. */
function bindOf(st: string): { name: string; op: '<-' | '='; rhs: string } | null {
  const m = /^(_|[A-Za-z_]\w*|`[^`]+`|\([^)]*\))\s*(<-|=(?!=))\s*([\s\S]*)$/.exec(st);
  return m ? { name: m[1], op: m[2] as '<-' | '=', rhs: m[3].trim() } : null;
}

/** `Name.In(a = x, b = y)` → its arguments by field (null: not that form). */
function namedArgs(call: string): Map<string, string> | null {
  const t = call.trim();
  const open = t.indexOf('(');
  if (open < 0) return /^[\w.`]+$/.test(t) ? new Map() : null;
  const close = closing(t, open);
  if (close !== t.length - 1) return null;
  const args = new Map<string, string>();
  for (const a of splitTop(t.slice(open + 1, close))) {
    const m = /^(`[^`]+`|[A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(a);
    if (!m) return null;
    args.set(m[1].replace(/^`|`$/g, ''), m[2].trim());
  }
  return args;
}

/**
 * The In of a call built in a method of the worker (`postFileActionIn(in)`, a mapping In -> <Service>.In):
 * its body is the In (`Svc.In(…)`) or a match over the cases of the worker's In, each building a case
 * (`case in: In.Simple => Svc.In.Simple(…)`) - the arguments of all, a field that differs between the
 * cases as it is (not readable as one mapping). The parameters named as at the call. null: not that form.
 */
function mapperArgs(input: string, methods: Map<string, ScalaMethod>): Map<string, string> | null {
  const call = /^([a-z]\w*)\(([\s\S]*)\)$/.exec(input.trim());
  const m = call ? methods.get(call[1]) : undefined;
  if (!call || !m) return null;
  const given = splitTop(call[2]).map(a => a.trim()).filter(Boolean);
  // a parameter passed under another name: that name in the body
  const rename = (v: string) => m.params.reduce((acc, p, i) => {
    const a = given[i];
    return a && a !== p.name && /^\w+$/.test(p.name) ? acc.replace(new RegExp(`\\b${p.name}\\b`, 'g'), a) : acc;
  }, v);
  const body = m.body.trim();
  if (!body.startsWith('in match') && !/^\w+ match\b/.test(body)) {
    const args = namedArgs(body);
    return args && new Map([...args].map(([k, v]) => [k, rename(v)]));
  }
  // the arms: `case x: In.Case =>` and what it builds
  const arms = body.split(/\n\s*case\s+[\w`]+\s*:\s*[\w.`]+\s*=>/).slice(1).map(a => namedArgs(a.trim()));
  if (!arms.length || arms.some(a => !a)) return null;
  const out = new Map<string, string>();
  for (const k of new Set(arms.flatMap(a => [...a!.keys()]))) {
    const values = new Set(arms.flatMap(a => (a!.has(k) ? [rename(a!.get(k)!)] : [])));
    out.set(k, values.size === 1 ? [...values][0] : [...values].join(' | '));
  }
  return out;
}

/** The statements of `runWorkZIO`. */
export function readWorkerCode(text: string): WorkerCode {
  const methods = methodsOf(text);
  const run = methods.get('runWorkZIO');
  const body = run?.body.trim() ?? '';
  if (!run || !body.startsWith('for')) return { items: null, methods };
  // the statements between `for` and `yield`
  const inner = body.split('\n').slice(1);
  const yieldAt = inner.findIndex(l => /^yield\b/.test(l));
  const sts = statements((yieldAt < 0 ? inner : inner.slice(0, yieldAt)).join('\n'));
  const items: WorkerItem[] = [];
  const binds = new Map<string, string>();
  for (const st of sts) {
    const b = bindOf(st);
    if (!b) { items.push({ kind: 'block', raw: st }); continue; }
    if (b.op === '=') {
      // an output of the call before it (or of a script)
      // an output of the call right before it - after own code it is own code too
      const prev = items[items.length - 1];
      const last = prev && prev.kind !== 'block' ? prev : undefined;
      if (last) last.outputs.set(b.name.replace(/^`|`$/g, ''), b.rhs);
      else items.push({ kind: 'block', raw: st });
      continue;
    }
    const opt = fromOption(b.rhs);
    if (opt) { binds.set(b.name, opt); continue; }
    const svc = /^run([A-Z]\w*)\(([\s\S]*)$/.exec(b.rhs);
    if (svc) {
      const open = b.rhs.indexOf('(');
      const close = closing(b.rhs, open);
      const input = close < 0 ? null : b.rhs.slice(open + 1, close).trim();
      const args = input === null ? null : input === 'NoInput()' ? new Map<string, string>() : namedArgs(input) ?? mapperArgs(input, methods);
      // a required input resolved before the call: its expression
      if (args) for (const [k, v] of args) if (binds.has(v)) args.set(k, `${binds.get(v)!}!`);
      items.push({ kind: 'service', service: svc[1], target: b.name, args, outputs: new Map(), raw: st });
      continue;
    }
    const call = /^([a-z]\w*)\(([\s\S]*)\)$/.exec(b.rhs);
    if (call && methods.has(call[1])) {
      const names = b.name.startsWith('(') ? splitTop(b.name.slice(1, -1)) : [b.name];
      items.push({ kind: 'mapping', method: call[1], names, args: splitTop(call[2]), outputs: new Map(), raw: st });
      continue;
    }
    items.push({ kind: 'block', raw: st });
  }
  return { items, methods };
}

// ── The lines of a mapping ───────────────────────────────────────────────────

/** A line of the code: the paths it reads (the first one set) and the extension it converts with. */
export interface CodeLink { from: string[]; ext?: string }
/** The case table of the code: the source and per its case the target case. */
export interface CodeCases { from: string; cases: { from: string; to: string }[] }

export interface CodeLinks {
  fields: Map<string, CodeLink>;
  cases: Map<string, CodeCases>;
  /** per path what the reader does not know - the code as it is */
  unreadable: Map<string, string>;
}

const strip = (n: string) => n.replace(/`/g, '');
const lastSeg = (t: string) => strip(t.split('.').pop() ?? t).replace(/`/g, '');
const IO_RESULT = /^IO\[\s*CustomError\s*,\s*([\s\S]+)\]$/;

/**
 * The paths of an expression and its mapper: `a.orElse(b)` → a, b; `x.flatMap(_.y)` → x.y;
 * `x.map(_.toCountry)` / `x.toCountry` / `Mappers.toCountry(x)` → ext toCountry. null: not of that form.
 */
export function pathsOf(expr: string, exts: Set<string>): CodeLink | null {
  let t = expr.trim();
  while (t.startsWith('(') && closing(t, 0) === t.length - 1) t = t.slice(1, -1).trim();
  // the first one set: `a.orElse(b)` / `a.getOrElse(b)`
  for (const op of ['.orElse(', '.getOrElse(']) {
    const at = lastTop(t, op);
    if (at >= 0 && closing(t, at + op.length - 1) === t.length - 1) {
      const left = pathsOf(t.slice(0, at), exts);
      const right = pathsOf(t.slice(at + op.length, -1), exts);
      if (!left || !right) return null;
      return { from: [...left.from, ...right.from], ...(left.ext ?? right.ext ? { ext: left.ext ?? right.ext } : {}) };
    }
  }
  // explicit on its object: `TypeMappers.toCountry(x)`
  const explicit = /^[A-Z]\w*\.(\w+)\(([\s\S]*)\)$/.exec(t);
  if (explicit && closing(t, t.indexOf('(')) === t.length - 1 && exts.has(explicit[1])) {
    const inner = pathsOf(explicit[2], exts);
    return inner && !inner.ext ? { from: inner.from, ext: explicit[1] } : null;
  }
  const segs: string[] = [];
  let ext: string | undefined;
  let rest = t;
  const head = /^(`[^`]+`|[A-Za-z_]\w*)/.exec(rest);
  if (!head) return null;
  segs.push(strip(head[1]));
  rest = rest.slice(head[1].length);
  while (rest) {
    // `.map(_.x)` `.flatMap(_.x)` `.map(_.map(_.x))` `.map(Obj.x)`
    const m = /^\.(map|flatMap)\(/.exec(rest);
    if (m) {
      const open = m[0].length - 1;
      const close = closing(rest, open);
      if (close < 0) return null;
      const arg = rest.slice(open + 1, close).trim();
      rest = rest.slice(close + 1);
      const step = /^_\.(`[^`]+`|\w+)$/.exec(arg) ?? /^_\.map\(_\.(\w+)\)$/.exec(arg) ?? /^(?:_\.map\()?[A-Z]\w*\.(\w+)\)?$/.exec(arg);
      if (!step) return null;
      const name = strip(step[1]);
      if (exts.has(name)) { if (ext) return null; ext = name; } else if (!ext) segs.push(name); else return null;
      continue;
    }
    const dot = /^\.(`[^`]+`|\w+)/.exec(rest);
    if (dot) {
      const name = strip(dot[1]);
      rest = rest.slice(dot[0].length);
      if (exts.has(name)) { if (ext) return null; ext = name; } else if (!ext) segs.push(name); else return null;
      continue;
    }
    return null;
  }
  return { from: [segs.join('.')], ...(ext ? { ext } : {}) };
}

/** The last index of `op` at the top level of `t`. */
function lastTop(t: string, op: string): number {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '"') { for (i++; i < t.length && t[i] !== '"'; i++) if (t[i] === '\\') i++; continue; }
    if (depth === 0 && t.startsWith(op, i)) found = i;
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
  }
  return found;
}

/** A method body as the export writes it: its required values (binds) and the value it builds. */
function bodyOf(body: string): { binds: Map<string, string>; value: string } | null {
  const t = body.trim();
  const unwrap = (v: string): string => {
    const s = v.trim();
    for (const w of ['mapped(', 'ZIO.succeed(']) {
      if (!s.startsWith(w)) continue;
      // `mapped("where")(value)` - the second argument list
      let at = w.length - 1;
      if (w === 'mapped(') { const e = closing(s, at); if (e < 0 || s[e + 1] !== '(') return s; at = e + 1; }
      const e = closing(s, at);
      if (e === s.length - 1) return s.slice(at + 1, e).trim();
    }
    return s;
  };
  if (!t.startsWith('for')) return { binds: new Map(), value: unwrap(t) };
  const lines = t.split('\n').slice(1);
  const yieldAt = lines.findIndex(l => /^yield\b/.test(l));
  if (yieldAt < 0) return null;
  const binds = new Map<string, string>();
  for (const st of statements(lines.slice(0, yieldAt).join('\n'))) {
    const b = bindOf(st);
    if (!b || b.op !== '<-') return null;
    binds.set(b.name, b.rhs);
  }
  let value = [lines[yieldAt].replace(/^yield\s*/, ''), ...lines.slice(yieldAt + 1)].join('\n').trim();
  // `built <- mapped(…)(value)` yield built
  const last = /^\w+$/.test(value) ? binds.get(value) : undefined;
  if (last !== undefined) { binds.delete(value); value = unwrap(last); }
  return { binds, value };
}

/** The lines a mapping method builds below `root` - per path of its target. */
export function mappingLinks(code: WorkerCode, method: string, roots: string[], exts: Set<string>): CodeLinks {
  const out: CodeLinks = { fields: new Map(), cases: new Map(), unreadable: new Map() };
  const m = code.methods.get(method);
  if (!m) { out.unreadable.set(roots.join(', '), `${method}: keine Methode im Worker`); return out; }
  readMethod(m, roots, code, exts, out, new Set());
  return out;
}

function readMethod(m: ScalaMethod, roots: string[], code: WorkerCode, exts: Set<string>, out: CodeLinks, seen: Set<string>) {
  if (seen.has(m.name)) return;
  seen.add(m.name);
  const t = m.body.trim();
  // the method only chooses: a match onto the methods of the cases
  if (/^[A-Za-z_]\w*\s+match\b/.test(t) && roots.length === 1) { caseValue(t, roots[0], code, exts, out, seen); return; }
  const b = bodyOf(t);
  if (!b) { out.unreadable.set(roots.join(', '), t); return; }
  if (roots.length > 1) {
    const inner = b.value.startsWith('(') && closing(b.value, 0) === b.value.length - 1 ? splitTop(b.value.slice(1, -1)) : null;
    if (!inner || inner.length !== roots.length) { out.unreadable.set(roots.join(', '), b.value); return; }
    roots.forEach((r, i) => valueLinks(inner[i], r, b.binds, new Map(), code, exts, out, seen));
    return;
  }
  valueLinks(b.value, roots[0], b.binds, new Map(), code, exts, out, seen);
}

/** `src match case src: Src.A => mapA(src) …` - the case table at `path`, the lines of each case below it. */
function caseValue(expr: string, path: string, code: WorkerCode, exts: Set<string>, out: CodeLinks, seen: Set<string>) {
  const lines = expr.split('\n');
  const from = /^([A-Za-z_]\w*)\s+match/.exec(lines[0].trim())?.[1] ?? '';
  const cases: { from: string; to: string }[] = [];
  for (const st of statements(lines.slice(1).join('\n'))) {
    const c = /^case\s+\w+\s*:\s*([\w.`-]+)\s*=>\s*(\w+)\(/.exec(st);
    if (!c) continue;
    const m = code.methods.get(c[2]);
    const to = m ? IO_RESULT.exec(m.result)?.[1] : undefined;
    if (!m || !to) { out.unreadable.set(path, st); continue; }
    cases.push({ from: lastSeg(c[1]), to: lastSeg(to) });
    readMethod(m, [path], code, exts, out, seen);
  }
  out.cases.set(path, { from, cases });
}

/** The value at `path`: a class field by field, a copy of a line onto it, a required one, an ADT - or a line. */
function valueLinks(expr: string, path: string, binds: Map<string, string>, lambdas: Map<string, string>,
  code: WorkerCode, exts: Set<string>, out: CodeLinks, seen: Set<string>) {
  let t = expr.trim();
  if (t.startsWith('???') || ['None', 'Seq.empty', 'Map.empty'].includes(t)) return;
  const some = /^Some\(([\s\S]*)\)$/.exec(t);
  if (some && closing(t, 4) === t.length - 1) t = some[1].trim();
  // a value bound before: required, an optional object per value, an ADT
  if (/^\w+$/.test(t) && binds.has(t)) {
    const io = binds.get(t)!.trim();
    const opt = fromOption(io);
    if (opt !== null) { valueLinks(opt, path, binds, lambdas, code, exts, out, seen); return; }
    const each = /^ZIO\.foreach\(/.exec(io);
    if (each) {
      const open = 'ZIO.foreach'.length;
      const close = closing(io, open);
      const second = close < 0 ? -1 : close + 1;
      const lam = second > 0 && io[second] === '(' ? /^\(\s*(\w+)\s*=>\s*([\s\S]*)\)$/.exec(io.slice(second)) : null;
      const over = close < 0 ? null : pathsOf(io.slice(open + 1, close), exts);
      if (!lam || !over) { out.unreadable.set(path, io); return; }
      out.fields.set(path, over);
      const b = bodyOf(lam[2]);
      if (!b) { out.unreadable.set(path, io); return; }
      valueLinks(b.value, path, new Map([...binds, ...b.binds]), new Map([...lambdas, [lam[1], over.from[0]]]), code, exts, out, seen);
      return;
    }
    if (/^[A-Za-z_]\w*\s+match\b/.test(io)) { caseValue(io, path, code, exts, out, seen); return; }
    out.unreadable.set(path, io);
    return;
  }
  // `x.copy(…)` - the line onto the object, then its fields
  const copy = /^([\s\S]+?)\.copy\(/.exec(t);
  if (copy && closing(t, copy[0].length - 1) === t.length - 1) {
    const recv = copy[1].trim();
    if (!lambdas.has(recv)) {
      const p = pathsOf(recv, exts);
      if (!p) { out.unreadable.set(path, t); return; }
      out.fields.set(path, p);
    }
    const args = namedArgs(`X${t.slice(copy[0].length - 1)}`);
    if (!args) { out.unreadable.set(path, t); return; }
    for (const [f, v] of args) valueLinks(v, `${path}.${f}`, binds, lambdas, code, exts, out, seen);
    return;
  }
  // a class built: field by field
  const ctor = /^([A-Z][\w.`-]*)\(/.exec(t);
  if (ctor && closing(t, ctor[0].length - 1) === t.length - 1) {
    const args = namedArgs(t);
    if (!args) { out.unreadable.set(path, t); return; }
    for (const [f, v] of args) valueLinks(v, `${path}.${f}`, binds, lambdas, code, exts, out, seen);
    return;
  }
  if (/^[A-Z][\w.`-]*$/.test(t) && !t.includes('.')) return; // a case without fields
  const p = pathsOf(t, exts);
  if (p) {
    // a value of a lambda: the path it stands for
    const lam = lambdas.get(p.from[0].split('.')[0]);
    if (lam) p.from = p.from.map(x => [lam, ...x.split('.').slice(1)].join('.'));
    out.fields.set(path, p);
  } else out.unreadable.set(path, t);
}

// ── An input or output of a service call as FEEL ─────────────────────────────

/**
 * A value of `runWorkZIO` as the FEEL of the step: `in.client.clientKey` → `= client.clientKey`, a
 * literal as it is - the paths of the In without `in.`. A required one (`!`) as its path. null: not of that form.
 */
export function feelOf(scala: string, exts: Set<string>): string | null {
  let t = scala.trim().replace(/!$/, '');
  const some = /^Some\(([\s\S]*)\)$/.exec(t);
  if (some && closing(t, 4) === t.length - 1) t = some[1].trim();
  if (/^(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?L?|true|false)$/.test(t)) return `= ${t.replace(/^(-?\d+)L$/, '$1')}`;
  const p = pathsOf(t, exts);
  if (!p || p.ext || p.from.length !== 1) return null;
  return `= ${p.from[0].replace(/^in\./, '')}`;
}
