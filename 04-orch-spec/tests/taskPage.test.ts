// A page for a user task (from the process): a new one with the fields of its Out and a button that
// completes it, or an existing one that gets that button - both found by pagesForTask afterwards.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pagesForTask, taskPageDraft, userTasksOfPage, withTaskButton } from '../src/pages/taskLinks';
import { pageFindings, targetsOf } from '../src/pages/designer/model';
import type { Page } from '../src/pages/runtime/spec';

const task = { key: 'ConfirmAppointmentTask', name: 'Termin bestätigen', process: 'Termin buchen' };

test('a new page for a user task: title and path from the task, with login, its Out as fields, a button that completes it', () => {
  const d = taskPageDraft(task, ['accepted', 'declineReason'], ['tasks/confirm-appointment-task']);
  assert.equal(d.title, 'Termin bestätigen');
  // the path is taken - the next one
  assert.equal(d.path, 'tasks/confirm-appointment-task-2');
  assert.deepEqual(d.page.access, { roles: [] });
  assert.deepEqual(d.page.body.map((b) => b.type), ['heading', 'fields', 'button']);
  const button = d.page.body[2] as Extract<Page['body'][number], { type: 'button' }>;
  assert.deepEqual(button.actions, [{ do: 'completeTask', taskKey: task.key, taskId: '{{task.taskId}}', input: { accepted: '{{accepted}}', declineReason: '{{declineReason}}' } }]);
  assert.deepEqual(userTasksOfPage(d.page), [task.key]);
  assert.match(d.describe, /Benutzer-Task «Termin bestätigen» im Prozess «Termin buchen»: die Felder «accepted», «declineReason» erfassen/);
  // without an Out: no fields block, the button completes it all the same
  assert.deepEqual(taskPageDraft(task, [], []).page.body.map((b) => b.type), ['heading', 'button']);
});

test('an existing page completes the user task: a button at its end - once', () => {
  const page: Page = { path: 'p', title: 'P', access: { roles: [] }, body: [{ type: 'heading', text: 'P' }] };
  const next = withTaskButton(page, task.key, ['accepted']);
  assert.deepEqual(next.body.map((b) => b.type), ['heading', 'button']);
  assert.deepEqual(pagesForTask(task.key, [{ slug: 'p', data: next }]), [{ slug: 'p', title: 'P' }]);
  assert.equal(withTaskButton(next, task.key, ['accepted']), next);
  // a hand-edited page without a body list gets one
  assert.deepEqual(withTaskButton({ ...page, body: 'x' as never }, task.key, []).body.map((b) => b.type), ['button']);
});

test('the new page is a valid page for the designer - no error, only what the RE still fills in', () => {
  const d = taskPageDraft(task, ['accepted'], []);
  const targets = targetsOf({ version: 1, services: [] }, []);
  const errors = pageFindings(d.page, targets, [d.page]).filter((f) => f.level === 'error');
  assert.deepEqual(errors, []);
});
