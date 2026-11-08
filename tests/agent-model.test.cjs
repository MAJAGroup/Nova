const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAgentAction, runAgent, MAX_STEPS } = require('../ai-agent');

test('parses actions and falls back to plain answers', () => {
  assert.deepEqual(parseAgentAction('```json\n{"action":"open","url":"https://www.google.com/travel/flights?q=x","say":"Checking"}\n```'),
    { action: 'open', url: 'https://www.google.com/travel/flights?q=x', say: 'Checking' });
  assert.deepEqual(parseAgentAction('<think>hmm</think>{"action":"answer","text":"Hi there"}'), { action: 'answer', text: 'Hi there' });
  assert.deepEqual(parseAgentAction('{"action":"read"}'), { action: 'read', say: '' });
  assert.equal(parseAgentAction('{"action":"open","url":"javascript:alert(1)"}').action, 'answer');
  assert.deepEqual(parseAgentAction('Just a sentence.'), { action: 'answer', text: 'Just a sentence.' });
});

test('opens a side tab, feeds page text back, and answers', async () => {
  const replies = [
    '{"action":"open","url":"https://example.test/flights","say":"Looking up flights"}',
    '{"action":"answer","text":"Cheapest is $212."}'
  ];
  const seen = [];
  const progress = [];
  const result = await runAgent({
    prompt: 'prices to SFO', tabs: [], today: '2026-11-07 (Saturday)',
    complete: async (messages) => { seen.push(messages.slice()); return { ok: true, text: replies.shift() }; },
    openSideTab: async (url) => ({ id: '7', title: 'Flights', url, text: 'United $212' }),
    readSideTab: async () => null,
    onProgress: (note) => progress.push(note)
  });
  assert.deepEqual(result, { ok: true, text: 'Cheapest is $212.', sideTab: '7' });
  assert.deepEqual(progress, ['Looking up flights']);
  assert.match(seen[0][0].content, /2026-11-07/);
  assert.match(seen[1].at(-1).content, /United \$212/);
  assert.match(seen[1].at(-1).content, /untrusted/);
});

test('stops after a bounded number of steps', async () => {
  let calls = 0;
  const result = await runAgent({
    prompt: 'loop', tabs: [], today: 'today',
    complete: async () => { calls++; return { ok: true, text: '{"action":"read"}' }; },
    openSideTab: async () => null,
    readSideTab: async () => ({ title: 'x', url: 'https://x.test', text: '' })
  });
  assert.equal(calls, MAX_STEPS);
  assert.equal(result.ok, true);
});

test('passes endpoint errors through', async () => {
  const result = await runAgent({
    prompt: 'x', tabs: [], today: 'today',
    complete: async () => ({ ok: false, error: 'down' }),
    openSideTab: async () => null, readSideTab: async () => null
  });
  assert.deepEqual(result, { ok: false, error: 'down' });
});

test('open_tabs ends the loop with the reply from openTabs', async () => {
  assert.deepEqual(parseAgentAction('{"action":"open_tabs","tabs":[{"url":"https://a.test","activate":true},"https://b.test",{"nope":1}],"text":"Opening"}'),
    { action: 'open_tabs', tabs: [{ url: 'https://a.test', activate: true }, { url: 'https://b.test', activate: false }], text: 'Opening' });
  let received;
  const result = await runAgent({
    prompt: 'open a and b', tabs: [], today: 'today',
    complete: async () => ({ ok: true, text: '{"action":"open_tabs","tabs":[{"url":"https://a.test"}],"text":"Opening a."}' }),
    openSideTab: async () => null, readSideTab: async () => null,
    openTabs: async (tabs, reply) => { received = tabs; return reply + ' Done.'; }
  });
  assert.deepEqual(received, [{ url: 'https://a.test', activate: false }]);
  assert.deepEqual(result, { ok: true, text: 'Opening a. Done.', sideTab: null });
});

test('says what it is opening even when the model gives no note', async () => {
  const replies = ['{"action":"open","url":"https://www.kayak.com/flights"}', '{"action":"read"}', '{"action":"answer","text":"Done."}'];
  const progress = [];
  await runAgent({
    prompt: 'x', tabs: [], today: 'today',
    complete: async () => ({ ok: true, text: replies.shift() }),
    openSideTab: async (url) => ({ id: '1', title: 'Kayak', url, text: '' }),
    readSideTab: async () => ({ title: 'Kayak', url: 'https://www.kayak.com/flights', text: 'ok' }),
    onProgress: (note) => progress.push(note)
  });
  assert.deepEqual(progress, ['Let me check kayak.com.', 'Taking another look.']);
});
