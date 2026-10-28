// Hash routing — the site is static (WebDAV), so no server rewrites.
//   #/                               companies
//   #/<company>                      overview
//   #/<company>/release
//   #/<company>/dependencies[/<project>]
//   #/<company>/catalog[?q=…]
//   #/<company>/devstats
//   #/<company>/api/<project>[?op=…] API documentation (from OpenApi.yml)
//   #/<company>/p/<page-slug>        markdown page (slug may contain `/`)
import { useEffect, useState } from 'react';

export type Route =
  | { kind: 'home' }
  | { kind: 'overview'; company: string }
  | { kind: 'release'; company: string }
  | { kind: 'dependencies'; company: string; project?: string }
  | { kind: 'catalog'; company: string; query: string }
  | { kind: 'api'; company: string; project: string; op?: string }
  | { kind: 'devstats'; company: string }
  | { kind: 'page'; company: string; slug: string };

export function parseHash(hash: string): Route {
  const [pathPart, queryPart] = hash.replace(/^#\/?/, '').split('?');
  const query = new URLSearchParams(queryPart ?? '');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { kind: 'home' };
  const company = parts[0];
  switch (parts[1]) {
    case undefined: return { kind: 'overview', company };
    case 'release': return { kind: 'release', company };
    case 'dependencies': return { kind: 'dependencies', company, project: parts[2] };
    case 'catalog': return { kind: 'catalog', company, query: query.get('q') ?? '' };
    case 'api': return { kind: 'api', company, project: parts[2], op: query.get('op') ?? undefined };
    case 'devstats': return { kind: 'devstats', company };
    case 'p': return { kind: 'page', company, slug: parts.slice(2).join('/') };
    default: return { kind: 'overview', company };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const href = {
  home: () => '#/',
  overview: (c: string) => `#/${c}`,
  release: (c: string) => `#/${c}/release`,
  dependencies: (c: string, p?: string) => `#/${c}/dependencies${p ? `/${p}` : ''}`,
  catalog: (c: string, q?: string) => `#/${c}/catalog${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  api: (c: string, p: string, op?: string) => `#/${c}/api/${p}${op ? `?op=${encodeURIComponent(op)}` : ''}`,
  devstats: (c: string) => `#/${c}/devstats`,
  page: (c: string, slug: string) => `#/${c}/p/${slug}`,
};

export const navigate = (h: string) => { window.location.hash = h; };
