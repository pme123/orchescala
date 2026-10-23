// Pages and user tasks: a page is for a user task when it completes one (`completeTask`), linked by the
// key of the interaction (`taskKey`). From a page to its task in the process and back - also used by
// the process view, so this stays small (not the page designer, which is loaded only on demand).
import { allSteps } from '../bpmn';
import type { ProcessSpec } from '../types';
import type { Page } from './runtime/spec';

/** The user tasks a page completes - [] for a simple page. Actions sit on load, on buttons, on choices
  * and in onError; the walk finds them wherever they are. */
export function userTasksOfPage(page: Page): string[] {
  const keys = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.do === 'completeTask' && typeof o.taskKey === 'string' && o.taskKey.trim()) keys.add(o.taskKey.trim());
    Object.values(o).forEach(walk);
  };
  walk(page);
  return [...keys];
}

/** Where a user task is: the process (slug, title) and its step. */
export type TaskStep = { key: string; slug: string; process: string; stepId: string; step: string };

export function userTaskStep(taskKey: string, specs: { slug: string; data: ProcessSpec }[]): TaskStep | null {
  for (const { slug, data } of specs) {
    const ia = (data.interactions ?? []).find((i) => i.kind === 'userTask' && i.key === taskKey);
    if (!ia) continue;
    const step = allSteps(data.steps).find((s) => s.id === ia.stepId);
    return { key: taskKey, slug, process: data.title || slug, stepId: ia.stepId, step: step?.name || ia.name || ia.stepId };
  }
  return null;
}

/** The pages that complete this user task. */
export function pagesForTask(taskKey: string, pages: { slug: string; data: Page }[]): { slug: string; title: string }[] {
  return pages.filter((p) => userTasksOfPage(p.data).includes(taskKey)).map((p) => ({ slug: p.slug, title: p.data.title || p.slug }));
}
