// Versand der Teams-Benachrichtigungen — wie im arch-review: sammelt die
// eigenen Beiträge mit noch offenen Empfängern (notifyPending), wartet nach
// dem letzten die eingestellte Zeit, schickt dann je Empfänger/in EINE
// Chat-Nachricht mit allen Kommentaren und markiert sie als benachrichtigt.
// Beim Verlassen des Prozesses (Zurück, Tab schliessen) wird sofort gesendet;
// was dabei nicht mehr durchkommt, bleibt offen und geht beim nächsten Öffnen.
import { useCallback, useEffect, useRef } from 'react';
import type { CommentEntry, CommentThread, TeamsNotifySettings } from '../types';
import { buildTeamsHtml, ensureOneOnOneChat, resolveTeamsUser, sendChatMessage, TEAMS_SCOPES, teamsDelayMs, teamsFail, teamsMock, TeamsError } from '../teams';
import { deepLink } from '../util';

export type TeamsProblem = { reason: 'consent' | 'forbidden' | 'error'; message: string };
type TokenResult = { ok: true; token: string } | { ok: false; reason: 'noAccount' | 'interaction' | 'error'; message: string };

const CONSENT = 'Für Teams-Benachrichtigungen fehlt noch deine Zustimmung zu «Chats erstellen» und «Chatnachrichten senden» (Chat.Create, ChatMessage.Send).';
const FORBIDDEN = 'Microsoft Graph verweigert das Senden: Die Berechtigungen Chat.Create / ChatMessage.Send fehlen in der App-Registrierung (Entra → API-Berechtigungen).';

/** Eigene Beiträge mit offenen Empfängern — samt ihrem Faden. */
function pendingOf(comments: CommentThread[], myEmail: string): { thread: CommentThread; entry: CommentEntry }[] {
  const me = myEmail.toLowerCase();
  if (!me) return [];
  return comments.flatMap(thread => thread.entries
    .filter(e => (e.email ?? '').toLowerCase() === me && (e.notifyPending?.length ?? 0) > 0)
    .map(entry => ({ thread, entry })));
}

export function useTeamsNotify(opts: {
  slug: string;
  processName: string;
  comments: CommentThread[];
  me: { id?: string; name: string; email?: string } | null;
  settings: TeamsNotifySettings | undefined;
  placeLabel: (target: string) => string;
  /** Zugestellte quittieren (in der Spezifikation) */
  onDelivered: (done: { entryId: string; email: string }[]) => void;
  tryToken: (scopes: string[]) => Promise<TokenResult>;
  onProblem: (p: TeamsProblem) => void;
  onSent: (recipients: string[]) => void;
  onFailed: (message: string) => void;
}) {
  const { comments, me, settings } = opts;
  const enabled = settings?.enabled === true && !!me?.email;
  const pending = enabled ? pendingOf(comments, me?.email ?? '') : [];
  const pendingKey = pending.map(p => `${p.entry.id}:${(p.entry.notifyPending ?? []).join(',')}`).join('|');
  const newest = pending.reduce((m, p) => (p.entry.at > m ? p.entry.at : m), '');

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const sendingRef = useRef(false);
  const problemShownRef = useRef(false);

  const send = useCallback(async () => {
    const o = optsRef.current;
    if (sendingRef.current || !o.me?.email || o.settings?.enabled !== true) return;
    const mine = pendingOf(o.comments, o.me.email);
    if (!mine.length) return;
    sendingRef.current = true;
    try {
      // Token — nie mit Redirect; fehlende Zustimmung wird einmal gemeldet
      let token = 'mock';
      const fail = teamsFail();
      if (fail === 'consent' || fail === 'forbidden') {
        if (!problemShownRef.current) {
          problemShownRef.current = true;
          o.onProblem(fail === 'consent' ? { reason: 'consent', message: CONSENT } : { reason: 'forbidden', message: FORBIDDEN });
        }
        return;
      }
      if (!teamsMock()) {
        const t = await o.tryToken(TEAMS_SCOPES);
        if (!t.ok) {
          if (t.reason === 'noAccount') return; // ohne Anmeldung kein Teams
          if (!problemShownRef.current) {
            problemShownRef.current = true;
            o.onProblem(t.reason === 'interaction' ? { reason: 'consent', message: CONSENT } : { reason: 'error', message: t.message });
          }
          return;
        }
        token = t.token;
      }
      // je Empfänger/in eine Nachricht mit allen offenen Kommentaren
      const myEmail = o.me.email.toLowerCase();
      const byRecipient = new Map<string, typeof mine>();
      for (const p of mine) for (const r of p.entry.notifyPending ?? []) {
        const key = r.toLowerCase();
        if (key === myEmail) continue;
        byRecipient.set(key, [...(byRecipient.get(key) ?? []), p]);
      }
      const done: { entryId: string; email: string }[] = [];
      const sentTo: string[] = [];
      let firstError: string | null = null;
      for (const [email, items] of byRecipient) {
        try {
          const user = await resolveTeamsUser(token, email);
          if (!user) { firstError = firstError ?? `${email} wurde im Verzeichnis nicht gefunden.`; continue; }
          const chatId = await ensureOneOnOneChat(token, o.me.id ?? 'me', user.id);
          const html = buildTeamsHtml({
            template: o.settings?.template,
            recipientName: user.displayName,
            senderName: o.me.name,
            processName: o.processName,
            processLink: deepLink(o.slug),
            lines: items.map(({ thread, entry }) => ({
              place: o.placeLabel(thread.target),
              text: entry.text,
              link: deepLink(o.slug, entry.id),
              // Antwort in einem Faden, den die Empfängerin angefangen hat
              ...(thread.entries[0] !== entry && (thread.entries[0]?.email ?? '').toLowerCase() === email ? { reply: true } : {}),
            })),
          });
          await sendChatMessage(token, chatId, html, user);
          items.forEach(({ entry }) => done.push({ entryId: entry.id, email }));
          sentTo.push(user.displayName);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (e instanceof TeamsError && e.forbidden && !problemShownRef.current) {
            problemShownRef.current = true;
            o.onProblem({ reason: 'forbidden', message: `Microsoft Graph verweigert das Senden: ${msg} Die Berechtigungen Chat.Create / ChatMessage.Send fehlen vermutlich in der App-Registrierung.` });
          }
          firstError = firstError ?? `${email}: ${msg}`;
        }
      }
      if (done.length) {
        o.onDelivered(done);
        o.onSent(sentTo);
      }
      if (firstError) o.onFailed(`Teams-Benachrichtigung nicht zugestellt — ${firstError}`);
    } finally {
      sendingRef.current = false;
    }
  }, []);

  // Wartezeit nach dem letzten eigenen Beitrag mit Empfängern
  useEffect(() => {
    if (!pendingKey) return;
    const due = Date.parse(newest) + teamsDelayMs(settings);
    const t = window.setTimeout(() => { void send(); }, Math.max(0, due - Date.now()));
    return () => window.clearTimeout(t);
  }, [pendingKey, newest, settings, send]);

  // Verlassen: sofort senden (beim Schliessen des Tabs kommt durch, was der
  // Browser noch zulässt)
  useEffect(() => {
    const h = () => { void send(); };
    window.addEventListener('pagehide', h);
    return () => { window.removeEventListener('pagehide', h); void send(); };
  }, [send]);

  return { pendingCount: pending.length };
}
