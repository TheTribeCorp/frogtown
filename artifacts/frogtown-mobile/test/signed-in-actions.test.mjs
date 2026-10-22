import assert from 'node:assert/strict';
import test from 'node:test';
import { customFetch, setAuthTokenGetter, setBaseUrl } from '../../../lib/api-client-react/src/custom-fetch.ts';

test('signed-in mobile timeline and daily-quest calls forward the wallet session', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  setBaseUrl('https://frogtown-test.invalid');
  setAuthTokenGetter(() => 'native-session-test-token');
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = new Headers(init?.headers);
    requests.push({ url, method: init?.method, headers, body: init?.body });
    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await customFetch('/api/gamification/summary', { method: 'GET' });
    await customFetch('/api/timeline/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'A test post from the authenticated mobile client.' }),
    });
    await customFetch('/api/gamification/check-in', { method: 'POST' });

    assert.deepEqual(requests.map(({ url, method }) => [url.pathname, method]), [
      ['/api/gamification/summary', 'GET'],
      ['/api/timeline/posts', 'POST'],
      ['/api/gamification/check-in', 'POST'],
    ]);
    for (const request of requests) {
      assert.equal(request.headers.get('authorization'), 'Bearer native-session-test-token');
    }
    assert.deepEqual(JSON.parse(requests[1].body), {
      body: 'A test post from the authenticated mobile client.',
    });
  } finally {
    globalThis.fetch = originalFetch;
    setAuthTokenGetter(null);
    setBaseUrl(null);
  }
});
