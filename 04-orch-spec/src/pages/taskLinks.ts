// Pages and user tasks: a page is for a user task when it completes one (`completeTask`), linked by the
// key of the interaction (`taskKey`). From a page to its task in the process and back - also used by
// the process view, so this stays small (not the page designer, which is loaded only on demand).
import { allSteps } from '../bpmn';
import type { ProcessSpec } from '../types';
import { actionsOf } from './pageActions';
import type { Page } from './runtime/spec';

/** The user tasks a page completes - [] for a simple page. */
export function userTasksOfPage(page: Page): string[] {
  return [...new Set(actionsOf(page).flatMap(({ action: a }) => (a.do === 'completeTask' && a.taskKey.trim() ? [a.taskKey.trim()] : [])))];
}

/** Where a user task is: the process (slug, title) and its step. */
export type TaskStep = { key: string; slug: string; process: string; stepId: string; step: string };

/** Every step with a user task of this key - more than one when two processes use the same key
  * (a page only knows the key, so it cannot tell them apart: the UI says so). */
export function userTaskSteps(taskKey: string, specs: { slug: string; data: ProcessSpec }[]): TaskStep[] {
  return specs.flatMap(({ slug, data }) => (data.interactions ?? [])
    .filter((i) => i.kind === 'userTask' && i.key === taskKey)
    .map((ia) => {
      const step = allSteps(data.steps).find((s) => s.id === ia.stepId);
      return { key: taskKey, slug, process: data.title || slug, stepId: ia.stepId, step: step?.name || ia.name || ia.stepId };
    }));
}

/** The pages that complete this user task. */
export function pagesForTask(taskKey: string, pages: { slug: string; data: Page }[]): { slug: string; title: string }[] {
  return pages.filter((p) => userTasksOfPage(p.data).includes(taskKey)).map((p) => ({ slug: p.slug, title: p.data.title || p.slug }));
}

/** For the tooltips: «Schritt – im Prozess «X»», with a warning when the key is in several processes. */
export function taskStepText(key: string, steps: TaskStep[]): string {
  if (!steps.length) return `${key} – in keinem Prozess gefunden`;
  const [first] = steps;
  const more = steps.length > 1
    ? `\n⚠ Der Schlüssel «${key}» kommt in ${steps.length} Prozessen vor (${steps.map((s) => s.process).join(', ')}) – der Link führt zum ersten.`
    : '';
  return `${first.step} – im Prozess «${first.process}»${more}`;
}
