// Sending of the Teams notifications — as in arch-review: collects the
// own posts with still open recipients (notifyPending), waits after
// the last one for the configured time, then sends ONE chat message per
// recipient with all comments and marks them as notified.
// When leaving the process (back, closing the tab), it is sent immediately;
// whatever no longer gets through stays open and goes out on the next opening.
import { useCallback, useEffect, useRef } from 'react';
import type { CommentEntry, CommentThread, TeamsNotifySettings } from '../types';
import { buildTeamsHtml, ensureOneOnOneChat, resolveTeamsUser, sendChatMessage, TEAMS_SCOPES, teamsDelayMs, teamsFail, teamsMock, TeamsError } from '../teams';
import { deepLink, type LinkSetup } from '../util';

export type TeamsProblem = { reason: 'consent' | 'forbidden' | 'error'; message: string };
type TokenResult = { ok: true; token: string } | { ok: false; reason: 'noAccount' | 'interaction' | 'error'; message: string };

const CONSENT = 'Für Teams-Benachrichtigungen fehlt noch deine Zustimmung zu «Chats erstellen» und «Chatnachrichten senden» (Chat.Create, ChatMessage.Send).';
const FORBIDDEN = 'Microsoft Graph verweigert das Senden: Die Berechtigungen Chat.Create / ChatMessage.Send fehlen in der App-Registrierung (Entra → API-Berechtigungen).';

/** Own posts with open recipients — together with their thread. */
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
  /** a page of the app instead of a process - for the links */
  linkKind?: 'spec' | 'page';
  comments: CommentThread[];
  me: { id?: string; name: string; email?: string } | null;
  settings: TeamsNotifySettings | undefined;
  placeLabel: (target: string) => string;
  /** setup for the links — recipients without a set-up browser */
  linkSetup?: LinkSetup | null;
  /** acknowledge the delivered ones (in the specification) */
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
      // token — never with redirect; missing consent is reported once
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
          if (t.reason === 'noAccount') return; // no Teams without sign-in
          if (!problemShownRef.current) {
            problemShownRef.current = true;
            o.onProblem(t.reason === 'interaction' ? { reason: 'consent', message: CONSENT } : { reason: 'error', message: t.message });
          }
          return;
        }
        token = t.token;
      }
      // one message per recipient with all open comments
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
            processLink: deepLink(o.slug, undefined, o.linkSetup, o.linkKind),
            lines: items.map(({ thread, entry }) => ({
              place: o.placeLabel(thread.target),
              text: entry.text,
              link: deepLink(o.slug, entry.id, o.linkSetup, o.linkKind),
              // reply in a thread the recipient started
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

  // waiting time after the last own post with recipients
  useEffect(() => {
    if (!pendingKey) return;
    const due = Date.parse(newest) + teamsDelayMs(settings);
    const t = window.setTimeout(() => { void send(); }, Math.max(0, due - Date.now()));
    return () => window.clearTimeout(t);
  }, [pendingKey, newest, settings, send]);

  // Leaving: send immediately (when closing the tab, whatever the
  // browser still allows gets through)
  useEffect(() => {
    const h = () => { void send(); };
    window.addEventListener('pagehide', h);
    return () => { window.removeEventListener('pagehide', h); void send(); };
  }, [send]);

  return { pendingCount: pending.length };
}
