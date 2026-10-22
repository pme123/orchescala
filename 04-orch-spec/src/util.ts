export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// lowercase letters, hyphens, no umlauts
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Deep link into the app: opens the specification and — with comment — the
 * comment panel at the place of this comment (App.tsx evaluates the
 * parameters on start; they survive the Microsoft login redirect).
 */
export function deepLink(slug: string, commentId?: string, setup?: LinkSetup | null): string {
  const u = new URL(import.meta.env.BASE_URL, document.baseURI);
  // like the setup link (auth.setupLink): whoever has not yet set up the browser
  // still gets directly into the right folder this way
  if (setup) {
    u.searchParams.set('tenant', setup.tenantId);
    u.searchParams.set('client', setup.clientId);
    if (setup.folderUrl) u.searchParams.set('folder', setup.folderUrl);
  }
  u.searchParams.set('spec', slug);
  if (commentId) u.searchParams.set('comment', commentId);
  return u.toString();
}

/** What a shared link brings along for setup — IDs of the sign-in, SharePoint folder */
export interface LinkSetup { tenantId: string; clientId: string; folderUrl?: string }

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO 8601 with local time zone, e.g. "2026-08-14T09:30:00+02:00"
export function nowIsoWithTimezone(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

// Short, stable ID for newly created elements (fields, types).
// Replies and references hang on it — they survive a rename.
export function uid(prefix = 'id'): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rnd}`;
}
