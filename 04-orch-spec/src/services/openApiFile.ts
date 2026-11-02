// An OpenAPI file, read once — for the import of a collection and already for
// creating one: the new collection then opens with the import of that file.
import { load } from 'js-yaml';
import { apiProblem, readApi, suggestApis, inPathPrefix } from './openApiRest';

export interface OpenApiFile { doc: unknown; file: string }

/** The file as a document — YAML or JSON, an OpenAPI 3 or a Swagger 2.0. */
export function parseOpenApi(text: string, file: string): { ok: true; value: OpenApiFile } | { ok: false; message: string } {
  let doc: unknown;
  try {
    doc = /\.json$/i.test(file) ? JSON.parse(text) : load(text);
  } catch (e) {
    return { ok: false, message: `«${file}» ist nicht lesbar: ${e instanceof Error ? e.message : String(e)}` };
  }
  const problem = apiProblem(doc);
  return problem ? { ok: false, message: `«${file}»: ${problem}` } : { ok: true, value: { doc, file } };
}

export async function readOpenApiFile(f: File): Promise<ReturnType<typeof parseOpenApi>> {
  return parseOpenApi(await f.text(), f.name);
}

/**
 * What a new collection takes from the OpenAPI: its title, and the API most of
 * its operations (under the sub path) suggest — `/clients/…` → `client`.
 */
export function collectionSuggestion(o: OpenApiFile, pathPrefix?: string): { title: string; api?: string } {
  const api = readApi(o.doc);
  const ops = api.operations.filter(op => inPathPrefix(op.path, pathPrefix?.trim() || undefined));
  const count = new Map<string, number>();
  for (const s of suggestApis(ops, { api: '', apiVersion: 1 }).values()) if (s.api) count.set(s.api, (count.get(s.api) ?? 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { title: api.title, ...(best ? { api: best } : {}) };
}

// ── from «Neue Collection» to the import of the new collection ────────────────
// The collection opens as its own view: the file waits here until it asks for it.
let pending: (OpenApiFile & { slug: string }) | null = null;

export function handOverOpenApi(slug: string, o: OpenApiFile): void {
  pending = { slug, ...o };
}

/** the file chosen when creating this collection — once */
export function takeOpenApi(slug: string): OpenApiFile | null {
  if (!pending || pending.slug !== slug) return null;
  const { doc, file } = pending;
  pending = null;
  return { doc, file };
}
