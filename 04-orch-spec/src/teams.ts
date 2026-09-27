// Teams-Benachrichtigung über Microsoft Graph — wie im arch-review: die
// kommentierende Person schickt der erwähnten Person eine persönliche
// Chat-Nachricht (1:1-Chat). Delegiert — die Nachricht kommt von der Person
// selbst, nicht von einem Dienst. Ablauf je Empfänger/in: Benutzer auflösen
// (id für den @-Mention), 1:1-Chat anlegen (Graph gibt den bestehenden
// zurück), Nachricht senden.
//
// Entwicklung: ?teamsmock simuliert Graph (Konsole statt Chat),
// ?teamsfail=consent|forbidden simuliert fehlende Berechtigungen,
// ?teamsdelay=<Sekunden> überschreibt die Wartezeit.
import type { TeamsNotifySettings } from './types';

export const TEAMS_SCOPES = ['Chat.Create', 'ChatMessage.Send', 'User.ReadBasic.All'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

export const DEFAULT_TEAMS_DELAY_MINUTES = 5;
export const DEFAULT_TEAMS_TEMPLATE = `{{empfaenger}} — {{von}} hat dich in der Prozess-Spezifikation «{{prozess}}» erwähnt oder dir geantwortet ({{anzahl}}):

{{kommentare}}

{{link}}`;

const devParam = (k: string) => (import.meta.env.DEV ? new URLSearchParams(location.search).get(k) : null);
export const teamsMock = () => devParam('teamsmock') !== null;
export const teamsFail = () => devParam('teamsfail');
export const teamsDelayMs = (settings: TeamsNotifySettings | undefined): number => {
  const dev = devParam('teamsdelay');
  if (dev !== null && !isNaN(Number(dev))) return Number(dev) * 1000;
  const min = settings?.delayMinutes;
  return (typeof min === 'number' && min >= 0 ? min : DEFAULT_TEAMS_DELAY_MINUTES) * 60_000;
};

export const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface TeamsCommentLine {
  /** die Stelle, z. B. «Get Responsible User · Eingabe consultantQuery» */
  place: string;
  text: string;
  /** Deep Link auf den Kommentar */
  link: string;
  /** Antwort auf einen Kommentar der Empfängerin */
  reply?: boolean;
}

/**
 * Nachricht als HTML: Vorlage (Klartext mit Platzhaltern) → Zeilenumbrüche zu
 * `<br>`, `{{empfaenger}}` wird zum echten @-Mention (`<at id="0">`), die
 * Kommentare zu einem festen Block je Kommentar mit Link.
 */
export function buildTeamsHtml(opts: {
  template?: string;
  recipientName: string;
  senderName: string;
  processName: string;
  processLink: string;
  lines: TeamsCommentLine[];
}): string {
  const tpl = opts.template?.trim() || DEFAULT_TEAMS_TEMPLATE;
  const kommentare = opts.lines.map(l =>
    `<b>${escapeHtml(l.place)}</b>${l.reply ? ' <i>(Antwort auf deinen Kommentar)</i>' : ''}<br>`
    + `«${escapeHtml(l.text).replace(/\n/g, '<br>')}»<br>`
    + `<a href="${escapeHtml(l.link)}">Kommentar öffnen</a>`,
  ).join('<br><br>');
  const vars: Record<string, string> = {
    empfaenger: `<at id="0">${escapeHtml(opts.recipientName)}</at>`,
    von: escapeHtml(opts.senderName),
    prozess: escapeHtml(opts.processName),
    anzahl: opts.lines.length === 1 ? '1 Kommentar' : `${opts.lines.length} Kommentare`,
    kommentare,
    link: `<a href="${escapeHtml(opts.processLink)}">Prozess öffnen</a>`,
  };
  // Vorlage escapen, Platzhalter danach durch (bereits sicheres) HTML ersetzen
  return escapeHtml(tpl)
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .replace(/\n/g, '<br>');
}

async function graph(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(`${GRAPH}${path}`, { ...init, headers });
}

export class TeamsError extends Error {
  constructor(message: string, public readonly forbidden = false) { super(message); }
}

const check = async (res: Response, what: string) => {
  if (res.ok) return;
  if (res.status === 403 || res.status === 401) throw new TeamsError(`${what}: keine Berechtigung (HTTP ${res.status}).`, true);
  let detail = '';
  try { detail = (await res.json())?.error?.message ?? ''; } catch { /* ignore */ }
  throw new TeamsError(`${what} fehlgeschlagen (HTTP ${res.status})${detail ? `: ${detail}` : ''}.`);
};

export async function resolveTeamsUser(token: string, email: string): Promise<{ id: string; displayName: string } | null> {
  if (teamsMock()) return { id: `mock-${email}`, displayName: email.split('@')[0] };
  const res = await graph(token, `/users/${encodeURIComponent(email)}?$select=id,displayName`);
  if (res.status === 404) return null;
  await check(res, 'Empfänger/in auflösen');
  const u = await res.json();
  return { id: String(u.id), displayName: String(u.displayName ?? email) };
}

/** 1:1-Chat anlegen — existiert er schon, liefert Graph den bestehenden. */
export async function ensureOneOnOneChat(token: string, myId: string, otherId: string): Promise<string> {
  if (teamsMock()) return `mock-chat-${otherId}`;
  const member = (id: string) => ({
    '@odata.type': '#microsoft.graph.aadUserConversationMember',
    roles: ['owner'],
    'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${id}')`,
  });
  const res = await graph(token, '/chats', { method: 'POST', body: JSON.stringify({ chatType: 'oneOnOne', members: [member(myId), member(otherId)] }) });
  await check(res, 'Chat anlegen');
  const chat = await res.json();
  return String(chat.id);
}

export async function sendChatMessage(token: string, chatId: string, html: string, mention: { id: string; displayName: string }): Promise<void> {
  if (teamsMock()) { console.info('[orch-spec] Teams (Mock) →', mention.displayName, '\n', html); return; }
  const body = {
    body: { contentType: 'html', content: html },
    mentions: [{
      id: 0,
      mentionText: mention.displayName,
      mentioned: { user: { id: mention.id, displayName: mention.displayName, userIdentityType: 'aadUser' } },
    }],
  };
  const res = await graph(token, `/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body: JSON.stringify(body) });
  await check(res, 'Nachricht senden');
}
