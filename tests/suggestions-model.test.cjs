const { test } = require('node:test');
const assert = require('node:assert/strict');
const { localSuggestions, createWebSuggestions, webQueryAllowed } = require('../search-suggestions.cjs');

test('local results match every word, prioritize open tabs, deduplicate visits, and preserve URL case', () => {
  const rows = localSuggestions('orbit docs', {
    visits: [
      { url: 'https://orbit.test/Docs', title: 'Orbit docs', at: 1 },
      { url: 'https://orbit.test/Docs', title: 'Orbit docs', at: 5 },
      { url: 'https://orbit.test/docs', title: 'Orbit docs lowercase', at: 3 },
      { url: 'https://unrelated.test/', title: 'Orbit alone', at: 9 }
    ],
    tabs: [{ id: '2', url: 'https://orbit.test/Docs', title: 'Orbit docs', lastAccessed: 2 },
      { id: '3', url: 'https://active.test/', title: 'Orbit docs active', lastAccessed: 10 }], activeId: '3'
  });
  assert.equal(rows[0].kind, 'search');
  assert.equal(rows[1].kind, 'tab');
  assert.equal(rows[1].tabId, '2');
  assert.equal(rows[2].value, 'https://orbit.test/docs');
  assert.equal(rows.length, 3);
});

test('empty input offers recent pages and only web URLs; address actions retain full input', () => {
  const rows = localSuggestions('', { visits: [
    { url: 'https://old.test/', at: 1 }, { url: 'https://new.test/', at: 9 },
    { url: 'file:///private.txt', at: 10 }, { url: 'javascript:alert(1)', at: 11 }
  ] });
  assert.deepEqual(rows.map(row => row.value), ['https://new.test/', 'https://old.test/']);
  for (const value of ['example.com:8443/docs?q=one#two', 'http://localhost:3000/path', '[::1]:8443/path']) {
    const first = localSuggestions(value)[0]; assert.equal(first.kind, 'url');
    assert.equal(first.value, new URL(value.startsWith('http:') ? value : 'https://' + value).href);
  }
  const long = 'https://example.com/?q=' + 'x'.repeat(1500);
  assert.equal(localSuggestions(long)[0].value, long);
  assert.equal(localSuggestions('orbit://newtab')[0].value, 'orbit://newtab');
  assert.equal(localSuggestions('javascript:alert(1)')[0].kind, 'search');
  assert.ok(!localSuggestions('secret', { visits: [{url:'https://user:secret@example.com/'}] })[1].description.includes('secret'));
});

test('autocomplete only requests ordinary words, with no credentials or browser cookies', async () => {
  const requests = [];
  const suggest = createWebSuggestions(async (url, options) => {
    requests.push({ url, options }); return { ok: true, text: async () => JSON.stringify(['space', ['space', 'space station', 'SPACE STATION', null, '<b>space</b>', 'space\nnews']]) };
  });
  for (const query of ['x', 'https://private.test/account?token=secret', 'private.test', 'name@example.com', 'foo/bar', 'x'.repeat(30), 'x'.repeat(101)]) {
    assert.equal(webQueryAllowed(query), false); assert.deepEqual(await suggest(query), []);
  }
  assert.equal(requests.length, 0);
  const rows = await suggest('space');
  assert.deepEqual(rows.map(row => row.value), ['space station', '<b>space</b>', 'space news']);
  assert.equal(new URL(requests[0].url).origin, 'https://suggestqueries.google.com');
  assert.equal(new URL(requests[0].url).searchParams.get('q'), 'space');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(await suggest('SPACE'), rows); assert.equal(requests.length, 1);
});

test('offline, malformed, oversized, and aborted autocomplete results degrade to no remote rows', async () => {
  for (const response of [{ ok: false }, { ok: true, text: async () => 'invalid' },
    { ok: true, text: async () => JSON.stringify({ suggestions: [] }) }, { ok: true, text: async () => 'x'.repeat(65537) }]) {
    assert.deepEqual(await createWebSuggestions(async () => response)('space'), []);
  }
  assert.deepEqual(await createWebSuggestions(async () => { throw Error('offline'); })('space'), []);
  const controller = new AbortController(); let requests = 0;
  const suggest = createWebSuggestions(async () => { requests++; controller.abort(); return { ok: true, text: async () => '["space",["space news"]]' }; });
  assert.deepEqual(await suggest('space', controller.signal), []);
  assert.equal((await suggest('space')).length, 1); assert.equal(requests, 2);
});
