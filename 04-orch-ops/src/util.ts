const pad = (n: number) => String(n).padStart(2, '0');

// lower case, hyphens, no umlauts
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ISO 8601 with local time zone, e.g. "2026-08-14T09:30:00+02:00"
export function nowIso(): string {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function fmtTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «vor 5 Min.», «gestern», «vor 3 Tagen» — for the list */
export function fmtRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d === 1) return 'gestern';
  if (d < 30) return `vor ${d} Tagen`;
  const mo = Math.round(d / 30);
  if (mo < 12) return mo === 1 ? 'vor 1 Monat' : `vor ${mo} Monaten`;
  const y = Math.round(d / 365);
  return y === 1 ? 'vor 1 Jahr' : `vor ${y} Jahren`;
}

export function uid(prefix = 'id'): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rnd}`;
}
