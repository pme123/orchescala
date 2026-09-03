// Loading the generated data, relative to the page — works at any base URL.
import { useEffect, useMemo, useState } from 'react';
import type { CompanyDocs, Project, SiteIndex } from './types';

export type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: T };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function useSiteIndex(): Loaded<SiteIndex> {
  const [v, setV] = useState<Loaded<SiteIndex>>({ state: 'loading' });
  useEffect(() => {
    fetchJson<SiteIndex>('index.json').then(data => setV({ state: 'ok', data }))
      .catch(e => setV({ state: 'error', message: String(e.message ?? e) }));
  }, []);
  return v;
}

const docsCache = new Map<string, Promise<CompanyDocs>>();
export function useCompanyDocs(company: string | undefined): Loaded<CompanyDocs> {
  const [v, setV] = useState<Loaded<CompanyDocs>>({ state: 'loading' });
  useEffect(() => {
    if (!company) return;
    setV({ state: 'loading' });
    if (!docsCache.has(company)) docsCache.set(company, fetchJson<CompanyDocs>(`${company}/docs.json`));
    let alive = true;
    docsCache.get(company)!.then(data => alive && setV({ state: 'ok', data }))
      .catch(e => alive && setV({ state: 'error', message: String(e.message ?? e) }));
    return () => { alive = false; };
  }, [company]);
  return v;
}

export function useMarkdown(url: string | undefined): Loaded<string> {
  const [v, setV] = useState<Loaded<string>>({ state: 'loading' });
  useEffect(() => {
    if (!url) return;
    setV({ state: 'loading' });
    let alive = true;
    fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); })
      .then(data => alive && setV({ state: 'ok', data }))
      .catch(e => alive && setV({ state: 'error', message: String(e.message ?? e) }));
    return () => { alive = false; };
  }, [url]);
  return v;
}

/** Derived lookups over a company's docs */
export function useDerived(docs: CompanyDocs) {
  return useMemo(() => {
    const byName = new Map<string, Project>(docs.projects.map(p => [p.name, p]));
    const dependsOn = new Map<string, { project: string; version: string }[]>();
    const usedBy = new Map<string, { project: string; version: string }[]>();
    for (const d of docs.dependencies) {
      dependsOn.set(d.project, d.dependsOn);
      for (const u of d.dependsOn) {
        if (!usedBy.has(u.project)) usedBy.set(u.project, []);
        usedBy.get(u.project)!.push({ project: d.project, version: d.version });
      }
    }
    // Project a catalog entry belongs to — derived from its URL (…/<project>/OpenApi.html)
    const catalogProject = (url: string) => url.match(/\/([\w-]+)\/OpenApi\.html/)?.[1];
    return { byName, dependsOn, usedBy, catalogProject };
  }, [docs]);
}
