// The calls of a page to the gateway: the token, a silent renewal on 401, then the login.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiError, gateway, postWith, type TokenSource } from '../src/pages/runtime/api';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** The gateway answers in turn; what it was sent is in `sent`. */
function gatewayAnswers(...answers: Response[]) {
  const sent: { url: string; auth?: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
    return answers.shift() ?? new Response(null, { status: 500 });
  }) as typeof fetch;
  return sent;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function tokens(renewed: string | null) {
  const calls = { renew: 0, login: 0 };
  const source: TokenSource = {
    accessToken: async () => 'old',
    renewToken: async () => { calls.renew++; return renewed; },
    reauthenticate: () => { calls.login++; return Promise.reject(new ApiError(401, 'Anmeldung …')); },
  };
  return { source, calls };
}

test('public - no token, no renewal on 401', async () => {
  const sent = gatewayAnswers(json({ ok: 1 }));
  const { source, calls } = tokens('new');
  assert.deepEqual(await postWith(source, '/public/worker/x', {}, true), { ok: 1 });
  assert.equal(sent[0].auth, undefined);

  gatewayAnswers(new Response('', { status: 401 }));
  await assert.rejects(postWith(source, '/public/worker/x', {}, true), (e: ApiError) => e.status === 401);
  assert.deepEqual(calls, { renew: 0, login: 0 });
});

test('401 - renewed silently and sent once more, no login', async () => {
  const sent = gatewayAnswers(new Response('', { status: 401 }), json({ done: true }));
  const { source, calls } = tokens('new');
  assert.deepEqual(await postWith(source, '/worker/x', {}, false), { done: true });
  assert.deepEqual(sent.map((s) => s.auth), ['Bearer old', 'Bearer new']);
  assert.deepEqual(calls, { renew: 1, login: 0 });
});

test('401 again after the renewal - to the login', async () => {
  const sent = gatewayAnswers(new Response('', { status: 401 }), new Response('', { status: 401 }));
  const { source, calls } = tokens('new');
  await assert.rejects(postWith(source, '/worker/x', {}, false), /Anmeldung/);
  assert.equal(sent.length, 2);
  assert.deepEqual(calls, { renew: 1, login: 1 });
});

test('no renewal possible - straight to the login, not sent again', async () => {
  const sent = gatewayAnswers(new Response('', { status: 401 }));
  const { source, calls } = tokens(null);
  await assert.rejects(postWith(source, '/worker/x', {}, false), /Anmeldung/);
  assert.equal(sent.length, 1);
  assert.deepEqual(calls, { renew: 1, login: 1 });
});

test('a success without JSON - the text, not an error (a second click would start again)', async () => {
  gatewayAnswers(new Response('4f1c-instance-id', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
  assert.equal(await postWith(tokens('new').source, '/process/x/async', {}, false), '4f1c-instance-id');
  gatewayAnswers(new Response('', { status: 200 }));
  assert.equal(await postWith(tokens('new').source, '/process/x/async', {}, false), null);
});

test('an error - the status and the errorMsg of the gateway; 204 is null', async () => {
  gatewayAnswers(json({ errorMsg: 'vergeben' }, 409));
  await assert.rejects(postWith(tokens('new').source, '/worker/x', {}, false), (e: ApiError) => e.status === 409 && e.message === 'vergeben');
  gatewayAnswers(new Response(null, { status: 204 }));
  assert.equal(await postWith(tokens('new').source, '/worker/x', {}, false), null);
});

test('the public paths - as the gateway serves them (PublicEndpoints: /public/worker|process|message)', async () => {
  const sent = gatewayAnswers(json({}), json({}), json({}), json({}));
  await gateway.call('acme-shop-freeSlots', {}, true);
  await gateway.start('acme-shop-bookV1', 'r-0123456789abcdef', {}, true);
  await gateway.message('acme-shop-bookV1-verified', 'r-0123456789abcdef', {}, true);
  await gateway.start('acme shop', undefined, {}, true);
  assert.deepEqual(sent.map((s) => [s.url, s.auth]), [
    ['/public/worker/acme-shop-freeSlots', undefined],
    ['/public/process/acme-shop-bookV1/async?businessKey=r-0123456789abcdef', undefined],
    ['/public/message/acme-shop-bookV1-verified?businessKey=r-0123456789abcdef', undefined],
    ['/public/process/acme%20shop/async', undefined],
  ]);
});
