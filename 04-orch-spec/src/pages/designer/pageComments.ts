// Comments on a page - like on a process (comments.ts): a speech bubble at the page and at every
// building block, a panel with the thread. The threads live in the spec part of the page
// (`page.spec.comments`), never in the bundle of the app. A building block is found by its ID,
// not by its key - the key changes with every move.
import { baseOf, type CommentTargetInfo } from '../../comments';
import { blockName } from '../../ai/diff';
import type { CommentThread } from '../../types';
import type { Page, PageSpec } from '../runtime/spec';
import { flatten } from './model';

/** The places of a page: the page itself and its building blocks. */
export const pageTarget = 'page';
export const blockTarget = (id: string) => `block:${id}`;

/** The ID of the building block behind a place - null for the page. */
export const blockOfTarget = (target: string): string | null => {
  const base = baseOf(target);
  return base.startsWith('block:') ? base.slice(6) : null;
};

/** All places in the order of the page: the page, then the building blocks as the outline shows them. */
export function pageCommentTargets(page: Page): CommentTargetInfo[] {
  const title = page.title || page.path || 'Seite';
  return [
    { key: pageTarget, label: `Seite ${title}`, group: 'Seite', element: title },
    ...flatten(page.body).flatMap(({ block }) =>
      block.id ? [{ key: blockTarget(block.id), label: blockName(block), group: 'Bausteine', element: blockName(block) }] : []),
  ];
}

/** Threads stay when their building block is removed - they remember its name (the panel shows them
  * under «Ohne Stelle»), as on a process (rememberPlaces). */
export function rememberPagePlaces(before: Page, after: Page): CommentThread[] | undefined {
  const comments = after.spec?.comments;
  if (!comments?.length) return comments;
  const was = new Map(pageCommentTargets(before).map((t) => [t.key, t.label]));
  const now = new Set(pageCommentTargets(after).map((t) => t.key));
  const next = comments.map((t) => {
    const label = was.get(t.target);
    return now.has(t.target) || !label || t.place === label ? t : { ...t, place: label };
  });
  return next.some((t, i) => t !== comments[i]) ? next : comments;
}

/** The spec part of a page without empty entries - undefined if nothing is left. */
export function cleanSpec(spec: PageSpec | undefined): PageSpec | undefined {
  const kept = Object.entries(spec ?? {}).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0));
  return kept.length ? (Object.fromEntries(kept) as PageSpec) : undefined;
}

/** `next` with the comments of `current` - an undo, a draft of Claude or an older state brings the
  * page back, not the comments (they are a history of their own). */
export function keepComments(next: Page, current: Page): Page {
  const comments = current.spec?.comments;
  if (JSON.stringify(next.spec?.comments ?? []) === JSON.stringify(comments ?? [])) return next;
  return { ...next, spec: cleanSpec({ ...next.spec, comments }) };
}
