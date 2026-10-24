// Export of the (filtered) list as CSV — semicolon and BOM, so that Excel
// reads umlauts and columns correctly without asking.
import type { ErrorEntry } from './types';
import { plainText } from './markdown';
import { fmtTimestamp } from './util';

const COLS: [string, (e: ErrorEntry) => string | number][] = [
  ['Prozess', e => e.process],
  ['Kurzbeschrieb', e => e.title],
  ['Aktivität', e => e.activity],
  ['Status', e => e.status.join(', ')],
  ['Count', e => e.count],
  ['Ticket', e => plainText(e.ticket)],
  ['Erfasser', e => e.reporter],
  ['Kommentar / Workaround', e => plainText(e.workaround)],
  ['Details', e => e.details],
  ['Letztes Update', e => fmtTimestamp(e.updatedAt)],
  ['Geändert von', e => e.updatedBy ?? ''],
  ['Erstellt', e => fmtTimestamp(e.createdAt)],
  ['ID', e => e.id],
];

const cell = (v: string | number) => {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(items: ErrorEntry[]): string {
  return [COLS.map(c => c[0]).join(';'), ...items.map(e => COLS.map(([, f]) => cell(f(e))).join(';'))].join('\r\n');
}

export function downloadCsv(items: ErrorEntry[], name: string) {
  const blob = new Blob(['﻿', toCsv(items)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
