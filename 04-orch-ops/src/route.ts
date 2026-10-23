// View, open error and filters in the address:
//
//   #/                         list (default: latest update on top)
//   #/?q=token&s=OFFEN,GELÖST&p=acme-addresschange&sort=count&archiv
//   #/e/<id>                   one error, above the list
//   #/neu                      create a new error
//   #/howto · #/admin
//
// Changing filters replaces the history entry; opening/closing adds a new
// one — so «Back» closes the error again.
// Responses of the Microsoft sign-in (#code=…) are left alone.
import type { ListState } from './components/ErrorsView';

export interface Route {
  view: 'list' | 'howto' | 'admin';
  id: string | null;
  isNew: boolean;
  list: ListState;
}

const DEFAULT_LIST: ListState = { q: '', status: [], process: '', sort: 'updated', archived: false };

export function readRoute(): Route {
  const h = window.location.hash;
  const base: Route = { view: 'list', id: null, isNew: false, list: { ...DEFAULT_LIST } };
  if (!h.startsWith('#/')) return base;
  const [path, query = ''] = h.slice(1).split('?');
  const qs = new URLSearchParams(query);
  const list: ListState = {
    q: qs.get('q') ?? '',
    status: (qs.get('s') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    process: qs.get('p') ?? '',
    sort: qs.get('sort') === 'count' ? 'count' : 'updated',
    archived: qs.has('archiv'),
  };
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'howto') return { ...base, view: 'howto', list };
  if (parts[0] === 'admin') return { ...base, view: 'admin', list };
  if (parts[0] === 'neu') return { ...base, isNew: true, list };
  if (parts[0] === 'e' && parts[1]) return { ...base, id: parts[1], list };
  return { ...base, list };
}

export function routeHash(r: Route): string {
  const path = r.view !== 'list' ? `/${r.view}` : r.isNew ? '/neu' : r.id ? `/e/${encodeURIComponent(r.id)}` : '/';
  const qs = new URLSearchParams();
  if (r.list.q) qs.set('q', r.list.q);
  if (r.list.status.length) qs.set('s', r.list.status.join(','));
  if (r.list.process) qs.set('p', r.list.process);
  if (r.list.sort !== 'updated') qs.set('sort', r.list.sort);
  if (r.list.archived) qs.set('archiv', '');
  const q = qs.toString().replace(/archiv=(&|$)/, 'archiv$1');
  return `#${path}${q ? `?${q}` : ''}`;
}

export function writeRoute(r: Route, push: boolean) {
  const cur = window.location.hash;
  if (cur && !cur.startsWith('#/')) return; // sign-in response or the like
  const next = routeHash(r);
  if (next === (cur || '#/')) return;
  const url = `${window.location.pathname}${window.location.search}${next}`;
  if (push) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}
