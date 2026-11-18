// Pages and user tasks: a page is for a user task when it completes one (`completeTask`), linked by the
// key of the interaction (`taskKey`). From a page to its task in the process and back - also used by
// the process view, so this stays small (not the page designer, which is loaded only on demand).
import { allSteps } from '../bpmn';
import type { ProcessSpec } from '../types';
import { actionsOf } from './pageActions';
import type { Page } from './runtime/spec';

/** The user tasks a page completes - [] for a simple page (a `completeTask` without a key does not count). */
export function userTasksOfPage(page: Page): string[] {
  return [...new Set(actionsOf(page).flatMap(({ action: a }) => (a.do === 'completeTask' && typeof a.taskKey === 'string' && a.taskKey.trim() ? [a.taskKey.trim()] : [])))];
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

// ---------------------------------------------------------------- a page for a user task

/** A new page for a user task - what the dialog «Neu» starts with: title and path from the step, with
  * a login, the fields of its Out and a button that completes it; with the AI a description for Claude. */
export type TaskPageDraft = { title: string; path: string; describe: string; page: Page };

/** The button that completes the task - its input every field of the Out (`{{field}}`). */
const completeButton = (taskKey: string, out: string[]): Page['body'][number] => ({
  type: 'button', label: 'Abschliessen', validate: true,
  actions: [{ do: 'completeTask', taskKey, taskId: '{{task.taskId}}', input: Object.fromEntries(out.map((f) => [f, `{{${f}}}`])) }],
});

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** The draft of a page for the user task `key` (its step `name`, in the process `process`); `out`: the fields
  * of its Out, `paths`: those of the other pages - the path gets a number if it is taken. */
export function taskPageDraft(task: { key: string; name: string; process: string }, out: string[], paths: string[]): TaskPageDraft {
  const title = task.name || task.key;
  const base = `tasks/${kebab(task.key) || 'task'}`;
  const path = [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}-${n}`)].find((p) => !paths.includes(p)) ?? `${base}-${paths.length + 1}`;
  const body: Page['body'] = [
    { type: 'heading', text: title },
    ...(out.length ? [{ type: 'fields' as const, fields: out.map((f) => ({ bind: f, label: f })) }] : []),
    completeButton(task.key, out),
  ];
  return {
    title, path,
    describe: `Eine Seite für den Benutzer-Task «${title}» im Prozess «${task.process}»: ${out.length ? `die Felder ${out.map((f) => `«${f}»`).join(', ')} erfassen` : 'den Task bestätigen'} und den Task mit «Abschliessen» abschliessen.`,
    page: { path, title, access: { roles: [] }, state: {}, body },
  };
}

/** The page with a button that completes the user task `key` at its end - the page as it is if it
  * completes it already. */
export function withTaskButton(page: Page, taskKey: string, out: string[]): Page {
  if (userTasksOfPage(page).includes(taskKey)) return page;
  return { ...page, body: [...(Array.isArray(page.body) ? page.body : []), completeButton(taskKey, out)] };
}
