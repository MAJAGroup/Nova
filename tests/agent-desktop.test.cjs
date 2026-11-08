const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { createServer } = require('node:http');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Push-to-talk → ElevenLabs (mocked in the main process) → agent opens a
// side tab → reply is spoken. The chat endpoint is a scripted local server.
test('a spoken request opens a side tab beside the page and answers from it', { timeout: 90000 }, async () => {
  const chatRequests = [];
  const server = createServer((req, res) => {
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const { messages } = JSON.parse(body);
        chatRequests.push(messages);
        const last = messages.at(-1).content;
        const content = /United \$212/.test(last)
          ? '{"action":"answer","text":"The cheapest flight to SFO next week is $212 on United."}'
          : JSON.stringify({ action: 'open', url: url + '/flights?q=' + encodeURIComponent('flights to SFO'), say: 'Checking Google Flights' });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/flights')) {
      // Results appear after load, like a script-rendered results page.
      res.end('<title>Flights to SFO</title><div id="r">Searching…</div><script>setTimeout(() => { document.getElementById("r").textContent = "United $212 · Alaska $240"; }, 400)</script>');
    } else {
      res.end('<title>Home page</title><h1>Home</h1>');
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = 'http://localhost:' + server.address().port;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'orbit-agent-'));
  await writeFile(path.join(profile, 'orbit-settings.json'), JSON.stringify({ bullsaiUrl: url + '/v1/chat/completions', model: 'test' }));
  let app;
  const until = async (check, label) => {
    const end = Date.now() + 20000;
    while (!await check()) {
      if (Date.now() > end) throw new Error('Timed out waiting for ' + label);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    app = await electron.launch({
      args: ['--use-fake-device-for-media-stream', path.resolve('.')],
      env: { ...process.env, ORBIT_USER_DATA: profile, ORBIT_START_URL: url + '/home', ORBIT_TEST_HIDDEN: '1', ELEVENLABS_API_KEY: 'test-key', BULLSAI_API_KEY: 'test-chat-key' }
    });
    const shell = await app.firstWindow();
    shell.setDefaultTimeout(15000);
    const errors = [];
    shell.on('pageerror', (error) => errors.push(error.message));
    await until(() => shell.evaluate(() => document.documentElement.dataset.orbitReady === 'true'), 'UI');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    const tabsNow = () => shell.evaluate(() => window.orbitBrowser.getTabs());
    await until(async () => (await tabsNow()).tabs.some((tab) => tab.title === 'Home page' && !tab.loading), 'home page');

    // Mock ElevenLabs inside the main process.
    await app.evaluate(() => {
      const realFetch = globalThis.fetch;
      globalThis.__eleven = [];
      globalThis.fetch = async (target, options = {}) => {
        const address = String(target);
        if (!address.startsWith('https://api.elevenlabs.io/')) return realFetch(target, options);
        const call = { url: address, key: options.headers['xi-api-key'] };
        if (address.endsWith('/speech-to-text')) {
          const file = options.body.get('file');
          call.model = options.body.get('model_id');
          call.bytes = file.size;
          call.type = file.type;
          globalThis.__eleven.push(call);
          return new Response(JSON.stringify({ text: 'Orbit, can you check the prices for a ticket to SFO next week?' }), { headers: { 'Content-Type': 'application/json' } });
        }
        call.body = JSON.parse(options.body);
        globalThis.__eleven.push(call);
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { headers: { 'Content-Type': 'audio/mpeg' } });
      };
    });

    await shell.locator('#assistant-reopen').click();
    await shell.locator('#assistant.expanded').waitFor();
    await shell.locator('#voice-input').click();
    await shell.locator('#voice-input.recording').waitFor();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await shell.locator('#voice-input').click();

    try {
      await shell.locator('.assistant-message .message-bubble', { hasText: '$212 on United' }).waitFor({ timeout: 30000 });
    } catch (error) {
      console.error('DEBUG chat:', await shell.locator('#chat-scroll').innerText(), '| toast:', await shell.locator('#toast').innerText(),
        '| status:', await shell.locator('#ai-status').innerText(), '| chat requests:', chatRequests.length,
        '| eleven:', JSON.stringify(await app.evaluate(() => globalThis.__eleven)), '| errors:', errors);
      throw error;
    }
    assert.equal(await shell.locator('.user-message .message-bubble').first().textContent(), 'Orbit, can you check the prices for a ticket to SFO next week?');

    const calls = await app.evaluate(() => globalThis.__eleven);
    const stt = calls.find((call) => call.url.endsWith('/speech-to-text'));
    assert.ok(stt && stt.bytes > 1000, 'recorded audio was sent for transcription');
    assert.equal(stt.key, 'test-key');
    assert.equal(stt.model, 'scribe_v1');
    await until(async () => (await app.evaluate(() => globalThis.__eleven)).some((call) => call.url.includes('/text-to-speech/')), 'spoken reply');
    const tts = (await app.evaluate(() => globalThis.__eleven)).find((call) => call.url.includes('/text-to-speech/'));
    assert.match(tts.body.text, /\$212 on United/);

    // The model saw today's date, and the page text after it rendered.
    assert.match(chatRequests[0][0].content, /Today is \d{4}-\d{2}-\d{2}/);
    assert.match(chatRequests[1].at(-1).content, /United \$212/);

    // The flights page is a side tab next to the still-active home page.
    const payload = await tabsNow();
    const side = payload.tabs.find((tab) => tab.id === payload.sideId);
    assert.ok(side, 'side tab exists');
    assert.match(side.url, /\/flights/);
    assert.equal(payload.tabs.find((tab) => tab.active).title, 'Home page');
    await shell.locator('#side-pane:not([hidden])').waitFor();
    assert.equal(await shell.locator('#side-pane-title').textContent(), 'Flights to SFO');
    assert.equal(await shell.locator('.browser-tab.side').count(), 1);

    const views = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter((view) => view.getVisible()).map((view) => ({ ...view.getBounds(), url: view.webContents.getURL() })));
    assert.equal(views.length, 2, 'main page and side tab are both visible');
    const homeView = views.find((view) => view.url.endsWith('/home'));
    const sideView = views.find((view) => view.url.includes('/flights'));
    assert.ok(homeView.x + homeView.width <= sideView.x, 'side tab sits to the right of the page');
    const assistantBox = await shell.locator('#assistant').boundingBox();
    assert.ok(sideView.x + sideView.width <= Math.ceil(assistantBox.x) + 1, 'side tab stays left of the assistant');

    // Making it the main tab ends the split.
    await shell.locator('#side-pane-promote').click();
    await until(async () => { const next = await tabsNow(); return !next.sideId && next.tabs.find((tab) => tab.active).url.includes('/flights'); }, 'promotion');
    await shell.locator('#side-pane').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
});
